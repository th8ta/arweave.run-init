import { StateInterface } from "@verto/contracts/build/collection/faces";
import path from "path";
import fs from "fs";

export const collectionState: StateInterface = {
  name: "Example collection",
  description: "A collection of example NFTs",
  owner: "",
  collaborators: [],
  items: []
};

export const collectionSource = new TextDecoder().decode(fs.readFileSync(path.join(__dirname, "../../assets/collection/contract.js")));