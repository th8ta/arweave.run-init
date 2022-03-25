import { StateInterface } from "@verto/contracts/build/nft/faces";
import path from "path";
import fs from "fs";

export const nftState: StateInterface = {
  name: "Example nft",
  title: "Example nft title",
  owner: "",
  ticker: "VNFT",
  description: "This is an example NFT.",
  balances: {},
  allowMinting: true,
  contentType: "image/png",
  createdAt: new Date().getTime().toString(),
  invocations: [],
  foreignCalls: []
};

export const nftSource = new TextDecoder().decode(fs.readFileSync(path.join(__dirname, "../../assets/nft/contract.js")));