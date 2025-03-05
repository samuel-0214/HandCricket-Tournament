use anchor_lang::{prelude::*, solana_program::hash::hashv, solana_program::system_instruction};

declare_id!("G9QiQW9iym33zfbsXTCoEp5bKCwgFf3KY5VB3UHKSW4w");

#[program]
pub mod handcricket {
    use super::*;

    pub fn initialize_tournament(ctx: Context<InitializeTournament>) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        
        tournament.admin = *ctx.accounts.admin.key;
        tournament.players_registered = 0;
        tournament.max_players = 100;
        tournament.entry_fee = 100000000; // 0.1 SOL in lamports
        tournament.total_pot = 0;
        tournament.is_active = true;
        tournament.tournament_end_time = Clock::get()?.slot + 86400; // ~1 day in slots
        
        msg!("Tournament initialized with 0.1 SOL entry fee and 100 player limit");
        Ok(())
    }

    //register for tournament by paying entry fee
    pub fn register_player(ctx: Context<RegisterPlayer>) -> Result<()> {
        let player_stats = &mut ctx.accounts.player_stats;
        let player = &ctx.accounts.player;
        
        //read the tournament values before mutably borrowing
        let is_active = ctx.accounts.tournament.is_active;
        let players_registered = ctx.accounts.tournament.players_registered;
        let max_players = ctx.accounts.tournament.max_players;
        let entry_fee = ctx.accounts.tournament.entry_fee;
        
        //check if tournament is active
        require!(is_active, HandCricketMineError::TournamentNotActive);
        
        //check if tournament is full
        require!(
            players_registered < max_players,
            HandCricketMineError::TournamentFull
        );
        
        //check if player is already registered
        require!(
            !player_stats.is_registered,
            HandCricketMineError::PlayerAlreadyRegistered
        );
        
        //transfer the entry fee from player to tournament account
        //using solana_program::system_instruction for the transfer
        let ix = system_instruction::transfer(
            player.key,
            &ctx.accounts.tournament.key(),
            entry_fee,
        );
        
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                player.to_account_info(),
                ctx.accounts.tournament.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        
        //now we can mutably borrow tournament after the invoke is complete
        let tournament = &mut ctx.accounts.tournament;
        
        //update tournament data
        tournament.players_registered += 1;
        tournament.total_pot += tournament.entry_fee;
        
        //initialize player stats
        player_stats.player = *player.key;
        player_stats.is_registered = true;
        player_stats.best_score = 0;
        player_stats.games_played = 0;
        
        msg!("Player registered for tournament and paid 0.1 SOL entry fee");
        Ok(())
    }

    //play one game in the tournament
    pub fn play_turn(ctx: Context<PlayTurn>, player_choice: u8) -> Result<()> {
        let game_account = &mut ctx.accounts.game_account;
        let player_stats = &mut ctx.accounts.player_stats;
        let tournament = &ctx.accounts.tournament;
        
        //check if tournament is active
        require!(tournament.is_active, HandCricketMineError::TournamentNotActive);
        
        //check if player is registered
        require!(
            player_stats.is_registered,
            HandCricketMineError::PlayerNotRegistered
        );

        //initialize game if not active
        if !game_account.is_active {
            game_account.player = *ctx.accounts.player.key;
            game_account.score = 0;
            game_account.is_active = true;
        }

        require!(
            player_choice >= 1 && player_choice <= 6,
            HandCricketMineError::InvalidChoice
        );

        let contract_choice: u8 = generate_contract_choice()?;

        msg!("Player Choice: {}", player_choice);
        msg!("Contract Choice: {}", contract_choice);

        if player_choice != contract_choice {
            game_account.score += player_choice as u32;
            msg!("Score: {}", game_account.score);
        } else {
            game_account.is_active = false;
            msg!("Game Over - Final Score: {}", game_account.score);
            
            //update player stats after game is over
            player_stats.games_played += 1;
            
            //update best score if current score is higher
            if game_account.score > player_stats.best_score {
                player_stats.best_score = game_account.score;
                msg!("New personal best score: {}", player_stats.best_score);
            }
        }
        
        Ok(())
    }
    
    //end tournament and distribute rewards to top players
    pub fn end_tournament(ctx: Context<EndTournament>) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        
        //only admin can end tournament
        require!(
            tournament.admin == *ctx.accounts.admin.key,
            HandCricketMineError::UnauthorizedAccess
        );
        
        //check if tournament is active
        require!(tournament.is_active, HandCricketMineError::TournamentAlreadyEnded);
        
        //ensure at least a minimum number of players participated
        require!(
            tournament.players_registered > 0,
            HandCricketMineError::InsufficientPlayers
        );
        
        //80% of pot goes to top 5 players
        let reward_pot = (tournament.total_pot as f64 * 0.8) as u64;
        
        //distribution percentages for top 5 players
        let distribution = [40, 25, 15, 10, 10]; // Percentages
        
        //transfer rewards to winners (simplified - in production you'd need a more complex approach)
        //here we're assuming the winners have already been determined and are passed in as accounts
        for i in 0..ctx.remaining_accounts.len().min(5) {
            let winner_share = (reward_pot as f64 * (distribution[i] as f64 / 100.0)) as u64;
            
            //safety check to ensure we don't overdraw
            if winner_share > 0 && winner_share <= **tournament.to_account_info().lamports.borrow() {
                //transfer reward to winner
                let winner = &ctx.remaining_accounts[i];
                **tournament.to_account_info().try_borrow_mut_lamports()? -= winner_share;
                **winner.try_borrow_mut_lamports()? += winner_share;
                
                msg!("Winner {} received {} lamports", i+1, winner_share);
            }
        }
        
        //transfer remaining 20% to admin
        let admin_share = tournament.total_pot - reward_pot;
        if admin_share > 0 && admin_share <= **tournament.to_account_info().lamports.borrow() {
            **tournament.to_account_info().try_borrow_mut_lamports()? -= admin_share;
            **ctx.accounts.admin.to_account_info().try_borrow_mut_lamports()? += admin_share;
            msg!("Admin received {} lamports", admin_share);
        }
        
        //mark tournament as ended
        tournament.is_active = false;
        msg!("Tournament ended and rewards distributed");
        
        Ok(())
    }
}

fn generate_contract_choice() -> Result<u8>{
    let clock = Clock::get()?;
    let slot = clock.slot;
    let unix_timestamp = clock.unix_timestamp as u64;

    let mut slot_bytes = slot.to_le_bytes().to_vec();
    let timestamp_bytes = unix_timestamp.to_le_bytes();
    slot_bytes.extend_from_slice(&timestamp_bytes);

    let hash_result = hashv(&[&slot_bytes]);

    let num = u64::from_le_bytes(hash_result.to_bytes()[..8].try_into().unwrap());

    let choice = ((num % 6) + 1) as u8;
    Ok(choice)
}

#[derive(Accounts)]
pub struct InitializeTournament<'info> {
    #[account(init, payer = admin, space = 8 + Tournament::SIZE)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(
        init,
        payer = player,
        space = 8 + PlayerStats::SIZE,
        seeds = [b"player-stats", tournament.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlayTurn<'info> { 
    #[account(init_if_needed, payer = player, seeds = [player.key().as_ref()], bump, space = 8 + GameAccount::SIZE)]  
    pub game_account: Account<'info, GameAccount>,
    #[account(
        mut,
        seeds = [b"player-stats", tournament.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>, 
}

#[derive(Accounts)]
pub struct EndTournament<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, constraint = tournament.admin == *admin.key)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    //top winners will be passed in as remaining_accounts
}

#[account]
pub struct Tournament {
    pub admin: Pubkey,              // 32 bytes
    pub players_registered: u64,    // 8 bytes
    pub max_players: u64,           // 8 bytes
    pub entry_fee: u64,             // 8 bytes
    pub total_pot: u64,             // 8 bytes
    pub is_active: bool,            // 1 byte
    pub tournament_end_time: u64,   // 8 bytes
}

impl Tournament {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8 + 1 + 8;
}

#[account]
pub struct PlayerStats {
    pub player: Pubkey,         // 32 bytes
    pub is_registered: bool,    // 1 byte
    pub best_score: u32,        // 4 bytes
    pub games_played: u32,      // 4 bytes
}

impl PlayerStats {
    pub const SIZE: usize = 32 + 1 + 4 + 4;
}

#[account]
pub struct GameAccount {
    pub player: Pubkey,     // 32 bytes
    pub score: u32,         // 4 bytes
    pub is_active: bool,    // 1 byte
}

impl GameAccount {
    pub const SIZE: usize = 32 + 4 + 1;
}

#[error_code]
pub enum HandCricketMineError {
    #[msg("The game is not active.")]
    GameNotActive,
    #[msg("Invalid choice. Please choose a number between 1 and 6.")]
    InvalidChoice,
    #[msg("Tournament is not active")]
    TournamentNotActive,
    #[msg("Tournament is already full")]
    TournamentFull,
    #[msg("Player is already registered")]
    PlayerAlreadyRegistered,
    #[msg("Player is not registered for this tournament")]
    PlayerNotRegistered,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    #[msg("Tournament is already ended")]
    TournamentAlreadyEnded,
    #[msg("Insufficient players to end tournament")]
    InsufficientPlayers,
}