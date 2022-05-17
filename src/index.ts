import { nftSource, nftState } from "./templates/nft";
import { collectionSource, collectionState } from "./templates/collection";
import { pscSource, pscState } from "./templates/psc";
import { communitySource, communityState } from "./templates/community";
import { clobSource, clobState } from "./templates/clob";

import { StateInterface as NftStateInterface } from "@verto/contracts/build/nft/faces";
import { StateInterface as CollectionStateInterface } from "@verto/contracts/build/collection/faces";
import { StateInterface as CommunityStateInterface } from "@verto/contracts/build/community/faces";
import { StateInterface as ClobStateInterface } from "@verto/contracts/build/clob/faces";

import { createContract, smartweave } from "smartweave";
import { readJSON } from "fs-extra";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { JWKInterface } from "arweave/node/lib/wallet";
import { lookup } from "mime-types";

import Arweave from "arweave";
import Transaction from "arweave/node/lib/transaction";

// gateway config
const client = new Arweave({
  host: "www.arweave.run",
  port: 443,
  protocol: "https"
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
  const masterWalletLocation = join(__dirname, "../master_wallet.json");
  let masterWallet: JWKInterface;

  try {
    masterWallet = await readJSON(masterWalletLocation);
  } catch {
    throw new Error(`Could not get master wallet from ${masterWalletLocation}`);
  }
  const masterWalletAddress = await client.wallets.getAddress(masterWallet);

  console.log("Minting AR tokens to master wallet...");
  await mintAr(masterWalletAddress);

  // deploy nft contract src
  console.log("Deploying NFT contract src...");
  const nftSourceID = await deploySource(nftSource, masterWallet);
  await client.api.get("mine");

  // deploy example nfts
  console.log("Deploying example nfts...");
  const exampleNFTIDs: string[] = [];

  for (let i = 0; i < 4; i++) {
    exampleNFTIDs.push(await deployContractWithData({
      data: await readFile(join(__dirname, `../assets/nft/nft_${i + 1}.png`)),
      tags: [{
        name: "Content-Type",
        value: "image/jpeg"
      }],
      srcTx: nftSourceID,
      state: JSON.stringify({
        ...nftState,
        name: `Example NFT #${i + 1}`,
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
      items: exampleNFTIDs
    } as CollectionStateInterface)
  );
  await client.api.get("mine");

  // deploy some PSCs
  console.log("Deploying psc logos...");
  const vertoLogoID = await deployLogo(join(__dirname, "../assets/psc/verto.svg"), masterWallet);
  const ardriveLogoID = await deployLogo(join(__dirname, "../assets/psc/ardrive.png"), masterWallet);
  await client.api.get("mine");

  console.log("Deploying pscs...");
  const pscIDs: string[] = [];

  let pscBalances: Record<string, number> = {
    [masterWalletAddress]: 2000
  };
  let pscVault: Record<string, {
    balance: number;
    end: number;
    start: number;
  }[]> = {
    [masterWalletAddress]: [{
      "balance": 1000,
      "end": 100,
      "start": 0
    }]
  };

  for (const addr of addresses) {
    pscBalances[addr] = 2000;
    pscVault[addr] = [
      {
        "balance": 1000,
        "end": 100,
        "start": 0
      }
    ];
  }

  for (let i = 0; i < 2; i++) {
    const communityName = i % 2 === 0 ? "verto" : "ardrive";

    pscIDs.push(
      await createContract(client, masterWallet, pscSource, JSON.stringify({
        ...pscState,
        name: communityName.toUpperCase(),
        ticker: communityName === "verto" ? "VRT" : "ARDRIVE",
        balances: pscBalances,
        vault: pscVault,
        settings: [
          ...pscState.settings,
          [
            "communityLogo",
            communityName === "verto" ? vertoLogoID : ardriveLogoID
          ]
        ]
      }, null, 4))
    );
    await client.api.get("mine");
  }

  console.log("Deploying USDC...");
  const logoID = await deployLogo(join(__dirname, "../assets/psc/usdc.png"), masterWallet);
  const usdcID = await smartweave.createContract(client, masterWallet, nftSource, JSON.stringify({
    name: "USD Stablecoin",
    title: "USD Stablecoin",
    owner: masterWalletAddress,
    ticker: "USDC",
    description: "Example USD stablecoin",
    balances: {
      [masterWalletAddress]: 1000000000,
      "ljvCPN31XCLPkBo9FUeB7vAK0VC6-eY52-CS-6Iho8U": 10000000,
    },
    allowMinting: true,
    contentType: "image/png",
    createdAt: new Date().getTime().toString(),
    invocations: [],
    foreignCalls: [],
    settings: [
      [
        "communityLogo",
        logoID
      ],
      [
        "communityDescription",
        "Example USD stablecoin to test with"
      ]
    ]
  }, null, 2));
  await client.api.get("mine");

  console.log("Deploying community contract...");
  const masterWalletVrtProfile = {
    username: "master",
    name: "Master Wallet",
    addresses: [masterWalletAddress]
  };

  const communityContractID = await createContract(client, masterWallet, communitySource, JSON.stringify({
    ...communityState,
    people: [masterWalletVrtProfile],
    tokens: [
      // nfts
      ...exampleNFTIDs.map((id) => ({
        id,
        type: "art",
        lister: masterWalletVrtProfile.username
      })),
      // collection
      {
        id: collectionID,
        type: "collection",
        lister: masterWalletVrtProfile.username
      },
      // PSCs
      ...pscIDs.map((id) => ({
        id,
        type: "community",
        lister: masterWalletVrtProfile.username
      })),
      // usdc
      {
        id: usdcID,
        type: "community",
        lister: masterWalletVrtProfile.username
      }
    ]
  } as CommunityStateInterface));
  await client.api.get("mine");

  console.log("Deploying clob contract...");
  const clobContractID = await createContract(client, masterWallet, clobSource, JSON.stringify({
    ...clobState,
    emergencyHaltWallet: masterWalletAddress,
    communityContract: communityContractID,
    pairs: [{
      pair: [usdcID, pscIDs[0]],
      orders: []
    }]
  } as ClobStateInterface));
  await client.api.get("mine");

  console.log("Writing result file...");
  await writeFile(join(__dirname, "../result.json"), new TextEncoder().encode(JSON.stringify({
    clobContractID,
    communityContractID,
    collectionID,
    pscIDs,
    exampleNFTIDs
  }, null, 2)));
})();

async function deployLogo(fileLoc: string, wallet: JWKInterface) {
  const logoTx = await client.createTransaction({
    data: await readFile(fileLoc)
  }, wallet);

  logoTx.addTag("Content-Type", lookup(fileLoc) || "image/png");

  await client.transactions.sign(logoTx, wallet);

  let uploader = await client.transactions.getUploader(logoTx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.log(`Deploying contract with data: ${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
  }

  return logoTx.id;
}

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

async function mintAr(addr: string, amount: number = 10000000000000) {
  await client.api.get(`/mint/${addr}/${amount}`);
}