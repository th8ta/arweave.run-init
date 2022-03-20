import { nftSource, nftState } from "./templates/nft";

import { createContract, createContractFromTx } from "smartweave";
import { readJSON } from "fs-extra";
import { join } from "path";
import { JWKInterface } from "arweave/node/lib/wallet"
import Arweave from "arweave";
import Transaction from "arweave/node/lib/transaction"

// gateway config
const client = new Arweave({
  host: "arweave.run",
  port: 443,
  protocol: "http"
});

// addresses that should own tokens deployed
// these will also be added as Verto ID owners
const addresses: string[] = [];

(async () => {
  console.log("==== Arweave.run setup script ====");

  try {
    await client.api.get("");
  } catch {
    throw new Error("Configured gateway is unavailable");
  }

  // load master wallet
  console.log("Loading master wallet...");
  // this will own all tokens
  // and can control master functions
  // of the CLOB contract
  const masterWalletLocation = join(__dirname, "../wallet.json");
  let masterWallet: JWKInterface;

  try {
    masterWallet = await readJSON(masterWalletLocation);
  } catch {
    throw new Error(`Could not get master wallet from ${masterWalletLocation}`);
  }

  console.log("Minting AR tokens to master wallet...");
  await mintAr(await client.wallets.getAddress(masterWallet));

  // deploy nft contract src
  console.log("Deploying NFT contract src...");
  const nftSourceID = await deploySource(nftSource, masterWallet);
})();

/**
 * @returns source tx id
 */
async function deploySource(src: string, wallet: JWKInterface) {
  const tx = await client.createTransaction({
    data: src
  }, wallet);

  tx.addTag("App-Name", "SmartWeaveContractSource");
  tx.addTag("App-Version", "0.3.0");
  tx.addTag("Content-Type", "application/javascript");

  let uploader = await client.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.log(`Source uploading: ${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
  }

  return tx.id;
}

async function mintAr(addr: string, amount: number = 1000000000000) {
  await client.api.get(`/mint/${addr}/${amount}`);
}