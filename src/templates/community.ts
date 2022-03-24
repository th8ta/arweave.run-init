import { StateInterface } from "@verto/contracts/build/community/faces";
import path from "path";
import fs from "fs";

export const communityState: StateInterface = {
  people: [],
  tokens: []
};

export const communitySource = new TextDecoder().decode(fs.readFileSync(path.join(__dirname, "../../assets/community/contract.js")));