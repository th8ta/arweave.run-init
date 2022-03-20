import { nftSource, nftState } from "./templates/nft";
import { collectionSource, collectionState } from "./templates/collection";

import { StateInterface as NftStateInterface } from "@verto/contracts/build/nft/faces";
import { StateInterface as CollectionStateInterface } from "@verto/contracts/build/collection/faces";

import { createContract, createContractFromTx } from "smartweave";
import { readJSON } from "fs-extra";
import { readFile } from "fs/promises";
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
  const masterWalletAddress = await client.wallets.getAddress(masterWallet);
  await mintAr(masterWalletAddress);

  // deploy nft contract src
  console.log("Deploying NFT contract src...");
  const nftSourceID = await deploySource(nftSource, masterWallet);

  // deploy example nfts
  console.log("Deploying example nfts...");
  const exampleNFTIDs: string[] = [];

  for (let i = 0; i < 20; i++) {
    exampleNFTIDs.push(await deployContractWithData({
      data: await readFile(join(__dirname, "../assets/nft/img.jpeg")),
      tags: [{
        name: "Content-Type",
        value: "image/jpeg"
      }],
      srcTx: nftSourceID,
      state: JSON.stringify({
        ...nftState,
        owner: masterWalletAddress,
        balances: {
          [masterWalletAddress]: 1
        }
      } as NftStateInterface)
    }, masterWallet));
  }

  // deploy a collection
  console.log("Deploying example collection...");
  const collectionID = await createContract(
    client,
    masterWallet,
    collectionSource,
    JSON.stringify({
      ...collectionState,
      owner: masterWalletAddress,
      collaborators: [
        ...addresses,
        masterWalletAddress
      ],
    } as CollectionStateInterface)
  );
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

  await client.transactions.sign(tx, wallet);

  let uploader = await client.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.log(`Source uploading: ${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
  }

  return tx.id;
}

/**
 * @returns contract id
 */
async function deployContractWithData(props: {
  data: string | Uint8Array | ArrayBuffer;
  srcTx?: string;
  src?: string;
  state: string;
  tags: {
    name: string;
    value: string;
  }[];
}, wallet: JWKInterface) {
  if (!props.srcTx && !props.src)
    throw new Error("Src tx or src is needed");

  let srcTx = props.srcTx;

  if (!srcTx && props.src)
    srcTx = await deploySource(props.src, wallet);

  const contract = await client.createTransaction({
    data: props.data
  }, wallet);

  if (props.tags)
    addTagsToTx(props.tags, contract);

  contract.addTag("App-Name", "SmartWeaveContract");
  contract.addTag("App-Version", "0.3.0");
  contract.addTag("Init-State", props.state);

  if (!srcTx)
    throw new Error("Src tx ID undefined");

  contract.addTag("Contract-Src", srcTx);

  await client.transactions.sign(contract, wallet);

  let uploader = await client.transactions.getUploader(contract);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.log(`Deploying contract with data: ${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
  }

  return contract.id;
}

function addTagsToTx(tags: {
  name: string;
  value: string;
}[], tx: Transaction) {
  for (const { name, value } of tags) {
    tx.addTag(name, value);
  }
}

async function mintAr(addr: string, amount: number = 1000000000000) {
  await client.api.get(`/mint/${addr}/${amount}`);
}