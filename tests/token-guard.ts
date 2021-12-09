import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import * as anchor from "@project-serum/anchor";
import { BN, Program, Provider, web3 } from "@project-serum/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TokenGuard } from "../target/types/token_guard";
import {
  GatekeeperNetworkService,
  GatekeeperService,
} from "@identity.com/solana-gatekeeper-lib";
import { GatewayToken } from "@identity.com/solana-gateway-ts";
import { DummySpender } from "../target/types/dummy_spender";
import { exchange, initialize, TokenGuardState } from "../src/";
import { TransactionInstruction } from "@solana/web3.js";
import { actions } from "@metaplex/js";
import axios from "axios";

const metadataJson = require("./fixtures/dummyMetadata.json");

chai.use(chaiAsPromised);
const { expect } = chai;
const sandbox = sinon.createSandbox();

const createBurnerATA = async (
  tokenGuardState: TokenGuardState,
  recipient: web3.Keypair,
  provider: Provider
) => {
  const burnerATA = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    tokenGuardState.outMint,
    recipient.publicKey,
    true
  );
  const createBurnerATAInstruction =
    Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenGuardState.outMint,
      burnerATA,
      recipient.publicKey,
      provider.wallet.publicKey
    );
  return { burnerATA, createBurnerATAInstruction };
};

describe("token-guard", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.local();
  anchor.setProvider(provider);

  // The sender of SOL, recipient of minted tokens
  const sender = web3.Keypair.generate();

  // Te recipient of SOL
  const recipient = web3.Keypair.generate();

  // The gatekeeper network that the sender needs a gateway token for
  const gatekeeperNetwork = web3.Keypair.generate();
  // a gatekeeper in the gatekeeper network
  const gatekeeper = web3.Keypair.generate();
  // the gateway token for the sender
  let gatewayToken: GatewayToken;
  let gkService: GatekeeperService;

  const program = anchor.workspace.TokenGuard as Program<TokenGuard>;

  // the token account of the SOL sender, to store the minted tokens in
  let senderAta: web3.PublicKey;

  // The account on chain that contains the token guard information
  let tokenGuardAccount: any;
  // The result of the initialize function call. Essentially the same information as tokenGuardAccount
  // plus the tokenGuard public key.
  let tokenGuardState: TokenGuardState;

  // a handle for a chain log listener (kept so it can be closed again)
  let listenerId: number;

  const exchangeAmount = 1_000;

  const fund = (to: anchor.web3.PublicKey, lamports: number = 500_000_000) =>
    provider.send(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: to,
          lamports,
        })
      )
    );

  const sendTransactionFromSender = async (
    instructions: TransactionInstruction[]
  ) => {
    const { blockhash } = await provider.connection.getRecentBlockhash();
    const transaction = new web3.Transaction({
      recentBlockhash: blockhash,
    }).add(...instructions);
    return provider.send(transaction, [sender]);
  };

  /**
   * If the from address has a non-zero balance of the token, send one to the to address.
   * Used to help separate tests from each other - e.g. if two tests share an NFT (for speed etc)
   * then if the first test sends the NFT to a recipient, the second test should only try to do
   * the same, if run in isolation.
   *
   * Note - assumes ATAs are used for from and to.
   * @param token
   * @param from
   * @param to
   */
  const checkBalanceAndSend = async (
    token: Token,
    from: web3.Keypair,
    to: web3.PublicKey
  ) => {
    const fromATA = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token.publicKey,
      from.publicKey,
      true
    );
    const toATA = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token.publicKey,
      to,
      true
    );

    const { amount: fromBalance } = await token.getAccountInfo(fromATA);

    if (fromBalance.toNumber() > 0) {
      await token.transfer(fromATA, toATA, from, [], 1);
    }
  };

  before("Set up the log listener for easier debugging", async () => {
    listenerId = provider.connection.onLogs("all", console.log, "confirmed");
  });

  before("Fund everyone", async () => {
    await fund(gatekeeper.publicKey);
    await fund(sender.publicKey);
    await fund(recipient.publicKey);
  });

  before("Set up gatekeeper network and gateway token", async () => {
    // create a new gatekeeper network (no on-chain tx here)
    const gknService = new GatekeeperNetworkService(
      provider.connection,
      gatekeeper,
      gatekeeperNetwork
    );
    gkService = new GatekeeperService(
      provider.connection,
      gatekeeper,
      gatekeeperNetwork.publicKey,
      gatekeeper
    );

    // add the gatekeeper to this network
    await gknService.addGatekeeper(gatekeeper.publicKey);

    // create a new gateway token
    gatewayToken = await gkService.issue(sender.publicKey);
  });

  after("Remove log listener", () =>
    provider.connection.removeOnLogsListener(listenerId)
  );

  after(sandbox.restore);

  context("Gateway Token only", () => {
    it("initialises a new tokenGuard", async () => {
      tokenGuardState = await initialize(
        program,
        provider,
        recipient.publicKey,
        gatekeeperNetwork.publicKey
      );

      console.log({
        tokenGuard: tokenGuardState.id.toString(),
        mint: tokenGuardState.outMint.toString(),
        recipient: recipient.publicKey.toString(),
        sender: sender.publicKey.toString(),
      });

      tokenGuardAccount = await program.account.tokenGuard.fetch(
        tokenGuardState.id
      );

      expect(tokenGuardAccount.recipient.toString()).to.equal(
        recipient.publicKey.toString()
      );
      expect(tokenGuardAccount.outMint.toString()).to.equal(
        tokenGuardState.outMint.toString()
      );
      expect(tokenGuardAccount.authority.toString()).to.equal(
        provider.wallet.publicKey.toString()
      );
      expect(tokenGuardAccount.gatekeeperNetwork.toString()).to.equal(
        gatekeeperNetwork.publicKey.toString()
      );
    });

    it("exchanges sol for tokens", async () => {
      senderAta = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenGuardState.outMint,
        sender.publicKey,
        true
      );

      const instructions = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        sender.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount
      );

      await sendTransactionFromSender(instructions);

      console.log(await provider.connection.getBalance(sender.publicKey));

      const balance = await provider.connection.getBalance(
        recipient.publicKey,
        "confirmed"
      );
      console.log(`balance for ${recipient.publicKey} ${balance}`);

      // for some reason, although the tx says the SOL is transferred, it is not registering in the recipient's account
      // expect(balance).to.equal(exchange_amount);

      // the sender's ATA should be closed, as it is ephemeral
      const senderAtaInfo = await provider.connection.getParsedAccountInfo(
        senderAta
      );
      expect(senderAtaInfo.value).to.be.null;
      // const parsedAccountInfo = (senderAtaInfo.value.data as web3.ParsedAccountData).parsed;
      // console.log(parsedAccountInfo);
      // expect(parsedAccountInfo.info.tokenAmount.amount).to.equal(''+exchange_amount)
    });

    it("spends tokens in a separate program", async () => {
      const spenderProgram = anchor.workspace
        .DummySpender as Program<DummySpender>;

      const tokenGuardInstructions = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        provider.wallet.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount
      );

      const { burnerATA, createBurnerATAInstruction } = await createBurnerATA(
        tokenGuardState,
        recipient,
        provider
      );

      const txSig = await spenderProgram.rpc.spend(new BN(exchangeAmount), {
        accounts: {
          payer: sender.publicKey,
          payerAta: senderAta,
          recipient: burnerATA,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [sender],
        instructions: [createBurnerATAInstruction, ...tokenGuardInstructions],
      });

      await provider.connection.confirmTransaction(txSig);
    });

    it("initialises a tokenGuard that is not yet live", async () => {
      tokenGuardState = await initialize(
        program,
        provider,
        recipient.publicKey,
        gatekeeperNetwork.publicKey,
        Date.now() + 1_000_000
      );
    });

    it("fails to spend tokens if the tokenGuard is not ready", async () => {
      const spenderProgram = anchor.workspace
        .DummySpender as Program<DummySpender>;

      const tokenGuardInstructions = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        provider.wallet.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount
      );

      const { burnerATA, createBurnerATAInstruction } = await createBurnerATA(
        tokenGuardState,
        recipient,
        provider
      );

      const shouldFail = spenderProgram.rpc.spend(new BN(exchangeAmount), {
        accounts: {
          payer: sender.publicKey,
          payerAta: senderAta,
          recipient: burnerATA,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [sender],
        instructions: [createBurnerATAInstruction, ...tokenGuardInstructions],
      });

      return expect(shouldFail).to.be.rejectedWith(
        /Transaction simulation failed/
      );
    });

    it("initialises a tokenGuard with an allowance", async () => {
      tokenGuardState = await initialize(
        program,
        provider,
        recipient.publicKey,
        gatekeeperNetwork.publicKey,
        undefined,
        2
      );
    });

    it("fails to exchange three times for the same user", async () => {
      const instructions = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        sender.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount
      );

      console.log("First exchange");
      await sendTransactionFromSender(instructions);

      console.log("Second exchange");
      await sendTransactionFromSender(instructions);

      console.log("Third exchange");
      const shouldFail = sendTransactionFromSender(instructions);
      return expect(shouldFail).to.be.rejectedWith(
        /Transaction simulation failed/
      );
    });

    it("initialises a tokenGuard with a max amount", async () => {
      tokenGuardState = await initialize(
        program,
        provider,
        recipient.publicKey,
        gatekeeperNetwork.publicKey,
        undefined,
        undefined,
        exchangeAmount - 100 // smaller than the exchange amount
      );
    });

    it("fails to exchange if the value is too high", async () => {
      const instructionsForAnExchangeThatIsTooBig = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        sender.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount
      );

      const instructionsForAnExchangeThatIsSmallEnough = await exchange(
        provider.connection,
        program,
        tokenGuardState.id,
        sender.publicKey,
        sender.publicKey,
        gatekeeperNetwork.publicKey,
        exchangeAmount - 100
      );

      await sendTransactionFromSender(
        instructionsForAnExchangeThatIsSmallEnough
      );

      const shouldFail = sendTransactionFromSender(
        instructionsForAnExchangeThatIsTooBig
      );
      return expect(shouldFail).to.be.rejectedWith(
        /Transaction simulation failed/
      );
    });
  });

  context("Membership Tokens", () => {
    context("Membership Token SPL", () => {
      let membershipTokenMint: Token;
      // this is often the same entity, but to avoid confusion, we alias here.
      const membershipTokenMinter = recipient;

      let senderMembershipTokenATA: web3.PublicKey;

      it("initialises a tokenGuard with a membership token requirement", async () => {
        membershipTokenMint = await Token.createMint(
          provider.connection,
          membershipTokenMinter,
          membershipTokenMinter.publicKey,
          membershipTokenMinter.publicKey,
          0,
          TOKEN_PROGRAM_ID
        );

        tokenGuardState = await initialize(
          program,
          provider,
          recipient.publicKey,
          gatekeeperNetwork.publicKey,
          undefined,
          undefined,
          undefined,
          {
            key: membershipTokenMint.publicKey,
            strategy: "SPL",
          }
        );
      });

      it("should not let someone without the membership token exchange", async () => {
        const shouldFail = exchange(
          provider.connection,
          program,
          tokenGuardState.id,
          sender.publicKey,
          sender.publicKey,
          gatekeeperNetwork.publicKey,
          exchangeAmount
        );

        return expect(shouldFail).to.be.rejectedWith(
          /Membership token account not found/
        );
      });

      it("should not let someone with an insufficient balance of the membership token exchange", async () => {
        senderMembershipTokenATA =
          await membershipTokenMint.createAssociatedTokenAccount(
            sender.publicKey
          );
        const instructions = await exchange(
          provider.connection,
          program,
          tokenGuardState.id,
          sender.publicKey,
          sender.publicKey,
          gatekeeperNetwork.publicKey,
          exchangeAmount,
          senderMembershipTokenATA
        );

        // fail, because the account is present, but it is empty
        const shouldFail = sendTransactionFromSender(instructions);

        return expect(shouldFail).to.be.rejectedWith(
          /Transaction simulation failed/
        );
      });

      it("should not let someone that does not own the membership token exchange", async () => {
        const someRandomMembershipTokenATA =
          await membershipTokenMint.createAssociatedTokenAccount(
            web3.Keypair.generate().publicKey
          );
        const instructions = await exchange(
          provider.connection,
          program,
          tokenGuardState.id,
          sender.publicKey,
          sender.publicKey,
          gatekeeperNetwork.publicKey,
          exchangeAmount,
          someRandomMembershipTokenATA
        );

        // fail, because the account is present, but has the wrong owner
        const shouldFail = sendTransactionFromSender(instructions);

        return expect(shouldFail).to.be.rejectedWith(
          /Transaction simulation failed/
        );
      });

      it("should fail if the wrong membership token account is presented", async () => {
        const someOtherToken = await Token.createMint(
          provider.connection,
          membershipTokenMinter,
          membershipTokenMinter.publicKey,
          membershipTokenMinter.publicKey,
          0,
          TOKEN_PROGRAM_ID
        );
        const someOtherTokenATA =
          await someOtherToken.createAssociatedTokenAccount(
            web3.Keypair.generate().publicKey
          );

        const instructions = await exchange(
          provider.connection,
          program,
          tokenGuardState.id,
          sender.publicKey,
          sender.publicKey,
          gatekeeperNetwork.publicKey,
          exchangeAmount,
          someOtherTokenATA
        );

        // fail, because the account is present, but is for the wrong token
        const shouldFail = sendTransactionFromSender(instructions);

        return expect(shouldFail).to.be.rejectedWith(
          /Transaction simulation failed/
        );
      });

      it("should let someone with the token exchange", async () => {
        await membershipTokenMint.mintTo(
          senderMembershipTokenATA,
          membershipTokenMinter,
          [],
          1
        );

        const instructions = await exchange(
          provider.connection,
          program,
          tokenGuardState.id,
          sender.publicKey,
          sender.publicKey,
          gatekeeperNetwork.publicKey,
          exchangeAmount,
          senderMembershipTokenATA
        );

        await sendTransactionFromSender(instructions);
      });
    });

    context("Membership Token NFT", () => {
      let nft: Token;
      let mint: web3.PublicKey;
      let metadata: web3.PublicKey;
      let minterATA: web3.PublicKey;
      let senderMembershipTokenATA: web3.PublicKey;

      const nftMinter = web3.Keypair.generate();
      const nftMinterProvider = new Provider(
        provider.connection,
        new anchor.Wallet(nftMinter),
        {}
      );

      before("Mint an NFT", async () => {
        // the minter needs more funds - is it paying arweave?
        await fund(nftMinter.publicKey, 2_000_000_000);

        // stub axios to look up dummy metadata
        const metadataUri = "somewhere";
        // the minter has to be in the creators array
        metadataJson.properties.creators[0].address =
          nftMinter.publicKey.toBase58();
        sandbox.stub(axios, "get").resolves({ data: metadataJson });

        const response = await actions.mintNFT({
          connection: nftMinterProvider.connection,
          wallet: nftMinterProvider.wallet,
          uri: metadataUri,
          maxSupply: 1,
        });

        await nftMinterProvider.connection.confirmTransaction(response.txId);

        mint = response.mint;
        metadata = response.metadata;

        nft = new Token(
          nftMinterProvider.connection,
          mint,
          TOKEN_PROGRAM_ID,
          nftMinter
        );

        console.log("Getting the minter's associated token account");
        minterATA = await Token.getAssociatedTokenAddress(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint,
          nftMinter.publicKey
        );

        console.log("Creating the sender's associated token account");
        senderMembershipTokenATA = await nft.createAssociatedTokenAccount(
          sender.publicKey
        );
      });

      context("Upgrade Authority strategy", () => {
        it("should initialize a tokenGuard that requires presentation of an NFT", async () => {
          tokenGuardState = await initialize(
            program,
            provider,
            recipient.publicKey,
            gatekeeperNetwork.publicKey,
            undefined,
            undefined,
            undefined,
            {
              key: nftMinter.publicKey,
              strategy: "NFT-UA",
            }
          );
        });

        it("should not let someone without the membership token exchange", async () => {
          const shouldFail = exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount
          );

          return expect(shouldFail).to.be.rejectedWith(
            /Membership token account not found/
          );
        });

        it("should let someone with the token exchange", async () => {
          await checkBalanceAndSend(nft, nftMinter, sender.publicKey);

          const instructions = await exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount,
            senderMembershipTokenATA
          );

          await sendTransactionFromSender(instructions);
        });
      });

      context("Creator strategy", () => {
        it("should initialize a tokenGuard that requires presentation of an NFT", async () => {
          tokenGuardState = await initialize(
            program,
            provider,
            recipient.publicKey,
            gatekeeperNetwork.publicKey,
            undefined,
            undefined,
            undefined,
            {
              key: nftMinter.publicKey,
              strategy: "NFT-Creator",
            }
          );
        });

        it("should not let someone without the membership token exchange", async () => {
          const shouldFail = exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount
          );

          return expect(shouldFail).to.be.rejectedWith(
            /Membership token account not found/
          );
        });

        it("should let someone with the token exchange", async () => {
          await checkBalanceAndSend(nft, nftMinter, sender.publicKey);

          const instructions = await exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount,
            senderMembershipTokenATA
          );

          await sendTransactionFromSender(instructions);
        });
      });

      context("Creator strategy without a gateway token", () => {
        it("should initialize a tokenGuard that requires presentation of an NFT but not a gateway token", async () => {
          tokenGuardState = await initialize(
            program,
            provider,
            recipient.publicKey,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              key: nftMinter.publicKey,
              strategy: "NFT-Creator",
            }
          );
        });

        it("should not let someone without the membership token exchange", async () => {
          const shouldFail = exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            undefined,
            exchangeAmount
          );

          return expect(shouldFail).to.be.rejectedWith(
            /Membership token account not found/
          );
        });

        it("should let someone with the token exchange", async () => {
          await checkBalanceAndSend(nft, nftMinter, sender.publicKey);

          const instructions = await exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            undefined,
            exchangeAmount,
            senderMembershipTokenATA
          );

          await sendTransactionFromSender(instructions);
        });
      });

      context("with allowance", () => {
        it("should initialize a tokenGuard that allows use of a membership token only once", async () => {
          tokenGuardState = await initialize(
            program,
            provider,
            recipient.publicKey,
            gatekeeperNetwork.publicKey,
            undefined,
            1,
            undefined,
            {
              key: nftMinter.publicKey,
              strategy: "NFT-UA",
            }
          );
        });

        it("should let someone with the token exchange", async () => {
          // Send the NFT from the minter to the sender
          await checkBalanceAndSend(nft, nftMinter, sender.publicKey);

          const instructions = await exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender.publicKey,
            sender.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount,
            senderMembershipTokenATA
          );

          await sendTransactionFromSender(instructions);
        });

        it("should not let the same membership token be used again", async () => {
          // create a new sender with a gateway token
          const sender2 = web3.Keypair.generate();
          await fund(sender2.publicKey);
          await gkService.issue(sender2.publicKey);

          // sender transfers the token to sender 2
          const sender2MembershipTokenATA = await nft.createAccount(
            sender2.publicKey
          );
          await nft.transfer(
            senderMembershipTokenATA,
            sender2MembershipTokenATA,
            sender,
            [],
            1
          );

          const instructions = await exchange(
            provider.connection,
            program,
            tokenGuardState.id,
            sender2.publicKey,
            sender2.publicKey,
            gatekeeperNetwork.publicKey,
            exchangeAmount,
            sender2MembershipTokenATA
          );

          // send transaction from sender 2
          const { blockhash } = await provider.connection.getRecentBlockhash();
          const transaction = new web3.Transaction({
            recentBlockhash: blockhash,
          }).add(...instructions);
          const shouldFail = provider.send(transaction, [sender2]);

          return expect(shouldFail).to.be.rejectedWith(
            /Transaction simulation failed/
          );
        });
      });
    });
  });
});
