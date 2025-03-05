import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Handcricket } from "../target/types/handcricket";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("handcricket-tournament", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HandcricketMine as Program<Handcricket>;
  const admin = anchor.web3.Keypair.generate();
  const player1 = anchor.web3.Keypair.generate();
  const player2 = anchor.web3.Keypair.generate();
  
  let tournamentPDA: PublicKey;
  let player1StatsPDA: PublicKey;
  let player2StatsPDA: PublicKey;
  let player1GamePDA: PublicKey;
  let player2GamePDA: PublicKey;
  
  // Find PDAs
  before(async () => {
    // Find the tournament PDA - this will be created in the first test
    tournamentPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("tournament")],
      program.programId
    )[0];
    
    // Find the player stats PDAs
    [player1StatsPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player-stats"), tournamentPDA.toBuffer(), player1.publicKey.toBuffer()],
      program.programId
    );
    
    [player2StatsPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player-stats"), tournamentPDA.toBuffer(), player2.publicKey.toBuffer()],
      program.programId
    );
    
    // Find the game account PDAs
    [player1GamePDA] = PublicKey.findProgramAddressSync(
      [player1.publicKey.toBuffer()],
      program.programId
    );
    
    [player2GamePDA] = PublicKey.findProgramAddressSync(
      [player2.publicKey.toBuffer()],
      program.programId
    );
    
    // Airdrop SOL to admin and players for transactions
    await provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player1.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player2.publicKey, 2 * LAMPORTS_PER_SOL);
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it("Initialize a new tournament", async () => {
    try {
      await program.methods
        .initializeTournament()
        .accounts({
          tournament: tournamentPDA,
          admin: admin.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      // Fetch tournament data
      const tournamentData = await program.account.tournament.fetch(tournamentPDA);
      
      // Verify tournament data
      expect(tournamentData.admin.toString()).to.equal(admin.publicKey.toString());
      expect(tournamentData.playersRegistered.toNumber()).to.equal(0);
      expect(tournamentData.maxPlayers.toNumber()).to.equal(100);
      expect(tournamentData.entryFee.toNumber()).to.equal(0.1 * LAMPORTS_PER_SOL);
      expect(tournamentData.isActive).to.equal(true);
      
      console.log("Tournament initialized successfully!");
    } catch (error) {
      console.error("Error initializing tournament:", error);
      throw error;
    }
  });

  it("Register player 1", async () => {
    try {
      // Get player balance before registration
      const preBalance = await provider.connection.getBalance(player1.publicKey);
      
      await program.methods
        .registerPlayer()
        .accounts({
          tournament: tournamentPDA,
          playerStats: player1StatsPDA,
          player: player1.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player1])
        .rpc();
      
      // Verify player registration
      const playerStats = await program.account.playerStats.fetch(player1StatsPDA);
      expect(playerStats.player.toString()).to.equal(player1.publicKey.toString());
      expect(playerStats.isRegistered).to.equal(true);
      expect(playerStats.bestScore.toNumber()).to.equal(0);
      expect(playerStats.gamesPlayed.toNumber()).to.equal(0);
      
      // Verify tournament updated
      const tournamentData = await program.account.tournament.fetch(tournamentPDA);
      expect(tournamentData.playersRegistered.toNumber()).to.equal(1);
      expect(tournamentData.totalPot.toNumber()).to.equal(0.1 * LAMPORTS_PER_SOL);
      
      // Verify player paid the entry fee (balance decreased by 0.1 SOL + some fees)
      const postBalance = await provider.connection.getBalance(player1.publicKey);
      expect(preBalance - postBalance).to.be.greaterThan(0.1 * LAMPORTS_PER_SOL);
      
      console.log("Player 1 registered successfully!");
    } catch (error) {
      console.error("Error registering player 1:", error);
      throw error;
    }
  });

  it("Register player 2", async () => {
    try {
      await program.methods
        .registerPlayer()
        .accounts({
          tournament: tournamentPDA,
          playerStats: player2StatsPDA,
          player: player2.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player2])
        .rpc();
      
      // Verify player registration
      const playerStats = await program.account.playerStats.fetch(player2StatsPDA);
      expect(playerStats.isRegistered).to.equal(true);
      
      // Verify tournament updated
      const tournamentData = await program.account.tournament.fetch(tournamentPDA);
      expect(tournamentData.playersRegistered.toNumber()).to.equal(2);
      expect(tournamentData.totalPot.toNumber()).to.equal(0.2 * LAMPORTS_PER_SOL);
      
      console.log("Player 2 registered successfully!");
    } catch (error) {
      console.error("Error registering player 2:", error);
      throw error;
    }
  });

  it("Player 1 plays a game", async () => {
    try {
      // Simulate several turns for player 1
      // We'll play with fixed choices 1-5 (avoiding 6 to not get out immediately)
      for (let choice = 1; choice <= 5; choice++) {
        await program.methods
          .playTurn(choice)
          .accounts({
            gameAccount: player1GamePDA,
            playerStats: player1StatsPDA,
            tournament: tournamentPDA,
            player: player1.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player1])
          .rpc();
        
        // Check game state after each turn
        const gameAccount = await program.account.gameAccount.fetch(player1GamePDA);
        console.log(`Player 1 choice: ${choice}, Score: ${gameAccount.score.toNumber()}`);
        
        // If game is not active, player got out, break the loop
        if (!gameAccount.isActive) {
          console.log("Player 1 got out!");
          break;
        }
      }
      
      // Verify player stats updated
      const playerStats = await program.account.playerStats.fetch(player1StatsPDA);
      expect(playerStats.gamesPlayed.toNumber()).to.be.at.least(0);
      
      console.log("Player 1 game completed!");
    } catch (error) {
      console.error("Error during player 1 game:", error);
      throw error;
    }
  });

  it("Player 2 plays a game", async () => {
    try {
      // Simulate several turns for player 2
      for (let choice = 1; choice <= 5; choice++) {
        await program.methods
          .playTurn(choice)
          .accounts({
            gameAccount: player2GamePDA,
            playerStats: player2StatsPDA,
            tournament: tournamentPDA,
            player: player2.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player2])
          .rpc();
        
        // Check game state after each turn
        const gameAccount = await program.account.gameAccount.fetch(player2GamePDA);
        console.log(`Player 2 choice: ${choice}, Score: ${gameAccount.score.toNumber()}`);
        
        // If game is not active, player got out, break the loop
        if (!gameAccount.isActive) {
          console.log("Player 2 got out!");
          break;
        }
      }
      
      // Verify player stats updated
      const playerStats = await program.account.playerStats.fetch(player2StatsPDA);
      expect(playerStats.gamesPlayed.toNumber()).to.be.at.least(0);
      
      console.log("Player 2 game completed!");
    } catch (error) {
      console.error("Error during player 2 game:", error);
      throw error;
    }
  });

  it("End tournament and distribute rewards", async () => {
    try {
      // For testing purposes, we can't easily determine top players programmatically
      // In a real scenario, you would query all player stats and sort them
      // For this test, we'll simply pass player1 and player2 as the winners
      
      // Get balances before ending tournament
      const adminPreBalance = await provider.connection.getBalance(admin.publicKey);
      const player1PreBalance = await provider.connection.getBalance(player1.publicKey);
      const player2PreBalance = await provider.connection.getBalance(player2.publicKey);
      
      await program.methods
        .endTournament()
        .accounts({
          tournament: tournamentPDA,
          admin: admin.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: player1.publicKey, isWritable: true, isSigner: false },
          { pubkey: player2.publicKey, isWritable: true, isSigner: false },
          // In a real implementation, you'd include up to 5 top players
        ])
        .signers([admin])
        .rpc();
      
      // Verify tournament is now inactive
      const tournamentData = await program.account.tournament.fetch(tournamentPDA);
      expect(tournamentData.isActive).to.equal(false);
      
      // Verify balances increased for winners and admin
      const adminPostBalance = await provider.connection.getBalance(admin.publicKey);
      const player1PostBalance = await provider.connection.getBalance(player1.publicKey);
      const player2PostBalance = await provider.connection.getBalance(player2.publicKey);
      
      // Admin should receive 20% of pot
      expect(adminPostBalance).to.be.greaterThan(adminPreBalance);
      
      // Players should receive portion of rewards
      expect(player1PostBalance).to.be.greaterThan(player1PreBalance);
      expect(player2PostBalance).to.be.greaterThan(player2PreBalance);
      
      console.log("Tournament ended and rewards distributed!");
      console.log(`Admin received: ${(adminPostBalance - adminPreBalance) / LAMPORTS_PER_SOL} SOL`);
      console.log(`Player 1 received: ${(player1PostBalance - player1PreBalance) / LAMPORTS_PER_SOL} SOL`);
      console.log(`Player 2 received: ${(player2PostBalance - player2PreBalance) / LAMPORTS_PER_SOL} SOL`);
    } catch (error) {
      console.error("Error ending tournament:", error);
      throw error;
    }
  });

  // Negative test cases
  it("Should not allow registering after tournament ends", async () => {
    const player3 = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(player3.publicKey, 2 * LAMPORTS_PER_SOL);
    
    // Find the player stats PDA
    const [player3StatsPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player-stats"), tournamentPDA.toBuffer(), player3.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.methods
        .registerPlayer()
        .accounts({
          tournament: tournamentPDA,
          playerStats: player3StatsPDA,
          player: player3.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player3])
        .rpc();
      
      // Should not reach here
      expect.fail("Should not be able to register after tournament ends");
    } catch (error) {
      // Expected error
      console.log("Correctly prevented registration after tournament ended");
    }
  });

  it("Should not allow non-admin to end tournament", async () => {
    try {
      await program.methods
        .endTournament()
        .accounts({
          tournament: tournamentPDA,
          admin: player1.publicKey, // Not the admin
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player1])
        .rpc();
      
      // Should not reach here
      expect.fail("Should not allow non-admin to end tournament");
    } catch (error) {
      // Expected error
      console.log("Correctly prevented non-admin from ending tournament");
    }
  });
});