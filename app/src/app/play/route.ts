import {
  Action,
  ActionError,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const headers = createActionHeaders();
const PROGRAM_ID = new PublicKey("Fam7iwYN6W82UGQSxY4e1MNsBDqHJV8aGBuMB2JHqcz4");
const TOURNAMENT_ADMIN = new PublicKey("9AhjZ7ybup47fvJNvFMCxhxVz3qs4serqVEXWmGAoMTx");

// Initialize tournament state
let tournamentActive = true;
let playersRegistered = 0;
const MAX_PLAYERS = 100;
const ENTRY_FEE = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL in lamports

// Maps to store player data
const registeredPlayers = new Map<string, boolean>();
const playerScores = new Map<string, number>();
const tournamentScores = new Map<string, number>(); // Track best scores for tournament

// Helper function to generate computer's move
const getComputerMove = () => Math.floor(Math.random() * 6) + 1;

// Find PDAs
const getTournamentPDA = () => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tournament")],
    PROGRAM_ID
  )[0];
};

const getPlayerStatsPDA = (playerPublicKey: PublicKey, tournamentPDA: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player-stats"), tournamentPDA.toBuffer(), playerPublicKey.toBuffer()],
    PROGRAM_ID
  )[0];
};

const getGameAccountPDA = (playerPublicKey: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [playerPublicKey.toBuffer()],
    PROGRAM_ID
  )[0];
};

export const GET = async () => {
  const payload: Action = {
    icon: "https://i.postimg.cc/52hr198Z/mainblink.png",
    label: "Hand Cricket Tournament 🏆",
    title: "Hand Cricket Tournament 🏆",
    description: "Join the Hand Cricket Tournament! Entry fee: 0.1 SOL",
    links: {
      actions: [
        {
          type: "transaction",
          label: "Register for Tournament",
          parameters: [],
          href: `/play/register`,
        },
        {
          type: "transaction",
          label: "Play Hand Cricket",
          parameters: [
            {
              type: "radio",
              name: "options",
              options: [
                { label: "Play 1", value: "1", selected: false },
                { label: "Play 2", value: "2", selected: false },
                { label: "Play 3", value: "3", selected: false },
                { label: "Play 4", value: "4", selected: false },
                { label: "Play 5", value: "5", selected: false },
                { label: "Play 6", value: "6", selected: false },
              ],
            },
          ],
          href: `/play/game`,
        },
      ],
    },
    type: "action",
  };

  return Response.json(payload, { headers });
};

export const POST = async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.split('/');
  const action = path[path.length - 1]; // Get the last part of the URL path

  try {
    const body: ActionPostRequest<{ options?: string }> & {
      params: ActionPostRequest<{ options?: string }>["data"];
    } = await req.json();

    console.log("body:", body);

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const connection = new Connection(
      process.env.SOLANA_RPC! || clusterApiUrl("devnet")
    );

    const accountKey = account.toString();
    const tournamentPDA = getTournamentPDA();
    const playerStatsPDA = getPlayerStatsPDA(account, tournamentPDA);
    const gameAccountPDA = getGameAccountPDA(account);

    // Handle different actions based on the URL path
    if (action === "register") {
      // Check if tournament is still active and not full
      if (!tournamentActive) {
        throw "Tournament is no longer active";
      }

      if (playersRegistered >= MAX_PLAYERS) {
        throw "Tournament is full (100 players max)";
      }

      if (registeredPlayers.get(accountKey)) {
        throw "You are already registered for this tournament";
      }

      // Register player transaction
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1000,
        }),
        new TransactionInstruction({
          programId: PROGRAM_ID,
          // Using register_player instruction (instruction discriminator + args)
          data: Buffer.from([163, 226, 140, 50, 240, 58, 39, 235]), // register_player instruction discriminator
          keys: [
            {
              pubkey: tournamentPDA,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: playerStatsPDA,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: account,
              isSigner: true,
              isWritable: true,
            },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
        })
      );

      transaction.feePayer = account;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      // Simulate successful registration for the Blink
      registeredPlayers.set(accountKey, true);
      playersRegistered++;

      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          transaction,
          message: `Registration successful! You've paid 0.1 SOL to enter the tournament. You can now play the game.`,
          type: "transaction",
          links: {
            next: {
              type: "inline",
              action: {
                type: "action",
                label: "Play Hand Cricket",
                icon: "https://i.postimg.cc/52hr198Z/mainblink.png",
                title: "Hand Cricket Tournament 🏏",
                description: "You're registered! Play your turn now.",
                links: {
                  actions: [
                    {
                      type: "transaction",
                      label: "Play Turn",
                      parameters: [
                        {
                          type: "radio",
                          name: "options",
                          options: [
                            { label: "Play 1", value: "1", selected: false },
                            { label: "Play 2", value: "2", selected: false },
                            { label: "Play 3", value: "3", selected: false },
                            { label: "Play 4", value: "4", selected: false },
                            { label: "Play 5", value: "5", selected: false },
                            { label: "Play 6", value: "6", selected: false },
                          ],
                        },
                      ],
                      href: `/play/game`,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      return Response.json(payload, { headers });

    } else if (action === "game") {
      // Check if player is registered
      if (!registeredPlayers.get(accountKey)) {
        throw "You must register for the tournament before playing";
      }

      const options = (body.params?.options || body.data?.options) as string | undefined;
      
      if (!options) {
        throw 'Invalid "options" provided';
      }

      const playerMove = parseInt(options);
      const computerMove = getComputerMove();
      const isOut = playerMove === computerMove;
      
      // Get current score or initialize to 0
      let currentScore = playerScores.get(accountKey) || 0;
      
      // Update score if not out
      if (!isOut) {
        currentScore += playerMove;
        playerScores.set(accountKey, currentScore);
      }

      // Play turn transaction
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1000,
        }),
        new TransactionInstruction({
          programId: PROGRAM_ID,
          // Using play_turn instruction (instruction discriminator + args)
          data: Buffer.from([116, 200, 44, 67, 23, 228, 209, 99, playerMove]),
          keys: [
            {
              pubkey: gameAccountPDA,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: playerStatsPDA,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: tournamentPDA,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: account,
              isSigner: true,
              isWritable: true,
            },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
        })
      );
      
      transaction.feePayer = account;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      // If player is out, update their tournament score if it's their best
      if (isOut) {
        const bestScore = tournamentScores.get(accountKey) || 0;
        if (currentScore > bestScore) {
          tournamentScores.set(accountKey, currentScore);
        }
      }

      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          transaction,
          message: isOut 
            ? `OUT! Computer played ${computerMove}. Game Over! Final Score: ${currentScore} runs 🏏` 
            : `You played ${playerMove}, Computer played ${computerMove}. Current Score: ${currentScore} runs 🏏`,
          type: "transaction",
          links: {
            next: isOut ? {
              type: "inline",
              action: {
                type: "action",
                label: "Game Over",
                icon: "https://i.postimg.cc/52hr198Z/mainblink.png",
                title: "Hand Cricket - Game Over! 🏏",
                description: `Game Over! Final Score: ${currentScore} runs 🎯`,
                links: {
                  actions: [
                    {
                      type: "transaction",
                      label: "Play Again",
                      parameters: [
                        {
                          type: "radio",
                          name: "options",
                          options: [
                            { label: "Play 1", value: "1", selected: false },
                            { label: "Play 2", value: "2", selected: false },
                            { label: "Play 3", value: "3", selected: false },
                            { label: "Play 4", value: "4", selected: false },
                            { label: "Play 5", value: "5", selected: false },
                            { label: "Play 6", value: "6", selected: false },
                          ],
                        },
                      ],
                      href: `/play/game`,
                    },
                    {
                      type: "transaction",
                      label: "View Tournament Leaderboard",
                      parameters: [],
                      href: `/play/leaderboard`,
                    },
                  ]
                },
              }
            } : {
              type: "inline",
              action: {
                type: "action",
                label: "Continue Playing",
                icon: "https://i.postimg.cc/52hr198Z/mainblink.png",
                title: "Play Hand Cricket ☝️ ✌️ 🖐️",
                description: `Current Score: ${currentScore} runs. Play your next turn! 🏏`,
                links: {
                  actions: [
                    {
                      type: "transaction",
                      label: "Play Turn",
                      parameters: [
                        {
                          type: "radio",
                          name: "options",
                          options: [
                            { label: "Play 1", value: "1", selected: false },
                            { label: "Play 2", value: "2", selected: false },
                            { label: "Play 3", value: "3", selected: false },
                            { label: "Play 4", value: "4", selected: false },
                            { label: "Play 5", value: "5", selected: false },
                            { label: "Play 6", value: "6", selected: false },
                          ],
                        },
                      ],
                      href: `/play/game`,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      // If player is out, reset their current game score
      if (isOut) {
        playerScores.delete(accountKey);
      }

      return Response.json(payload, { headers });

    } else if (action === "leaderboard") {
      // Create a sorted leaderboard from the tournament scores
      const sortedScores = Array.from(tournamentScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Show top 10 players
      
      let leaderboardText = "🏆 Tournament Leaderboard 🏆\n\n";
      
      if (sortedScores.length === 0) {
        leaderboardText += "No scores recorded yet!";
      } else {
        sortedScores.forEach((entry, index) => {
          const [publicKey, score] = entry;
          const shortenedKey = `${publicKey.substring(0, 4)}...${publicKey.substring(publicKey.length - 4)}`;
          leaderboardText += `${index + 1}. ${shortenedKey}: ${score} runs\n`;
        });
      }

      // Create a simple transaction that doesn't do anything - just to satisfy the type requirements
      const emptyTransaction = new Transaction();
      emptyTransaction.feePayer = account;
      emptyTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const payload: ActionPostResponse = await createPostResponse({
        fields: {
          message: leaderboardText,
          transaction: emptyTransaction,
          type: "transaction",
          links: {
            next: {
              type: "inline",
              action: {
                type: "action",
                label: "Back to Game",
                icon: "https://i.postimg.cc/52hr198Z/mainblink.png",
                title: "Hand Cricket Tournament 🏏",
                description: "Play the Hand Cricket tournament game",
                links: {
                  actions: [
                    {
                      type: "transaction",
                      label: "Play Turn",
                      parameters: [
                        {
                          type: "radio",
                          name: "options",
                          options: [
                            { label: "Play 1", value: "1", selected: false },
                            { label: "Play 2", value: "2", selected: false },
                            { label: "Play 3", value: "3", selected: false },
                            { label: "Play 4", value: "4", selected: false },
                            { label: "Play 5", value: "5", selected: false },
                            { label: "Play 6", value: "6", selected: false },
                          ],
                        },
                      ],
                      href: `/play/game`,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      return Response.json(payload, { headers });
    }

    // Default fallback if action is not recognized
    throw "Invalid action requested";

  } catch (error) {
    console.log(error);
    const actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof error == "string") actionError.message = error;
    return Response.json(actionError, {
      status: 400,
      headers,
    });
  }
};

// For admin only - endpoint to end tournament and distribute rewards
export const endTournament = async (req: Request) => {
  try {
    const body = await req.json();
    
    let adminKey: PublicKey;
    try {
      adminKey = new PublicKey(body.admin);
      // Verify this is the admin
      if (adminKey.toString() !== TOURNAMENT_ADMIN.toString()) {
        throw "Unauthorized access";
      }
    } catch {
      throw "Invalid admin key or unauthorized access";
    }

    // Create end tournament transaction
    const connection = new Connection(
      process.env.SOLANA_RPC! || clusterApiUrl("devnet")
    );

    const tournamentPDA = getTournamentPDA();
    
    // Get top 5 players
    const topPlayers = Array.from(tournamentScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pubkeyStr]) => new PublicKey(pubkeyStr));
    
    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1000,
      }),
      new TransactionInstruction({
        programId: PROGRAM_ID,
        // Using end_tournament instruction
        data: Buffer.from([181, 157, 76, 40, 192, 202, 196, 148]), // end_tournament instruction discriminator
        keys: [
          {
            pubkey: tournamentPDA,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: adminKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          // Add the top 5 players as remaining accounts
          ...topPlayers.map(pubkey => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
        ],
      })
    );
    
    transaction.feePayer = adminKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Reset tournament state
    tournamentActive = false;
    
    const payload = {
      transaction: transaction.serialize({requireAllSignatures: false}).toString('base64'),
      message: "Tournament ended. Rewards distributed to top 5 players.",
    };

    return Response.json(payload, { headers });
  } catch (error) {
    console.log(error);
    const actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof error == "string") actionError.message = error;
    return Response.json(actionError, {
      status: 400,
      headers,
    });
  }
};

export const OPTIONS = async () => Response.json(null, { headers });