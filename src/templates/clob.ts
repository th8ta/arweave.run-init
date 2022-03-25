import { StateInterface } from "@verto/contracts/build/clob/faces";
import path from "path";
import fs from "fs";

export const clobState: StateInterface = {
  emergencyHaltWallet: "",
  halted: false,
  protocolFeePercent: 1,
  pairGatekeeper: false,
  communityContract: "",
  pairs: [],
  invocations: [],
  foreignCalls: []
};

export const clobSource = new TextDecoder().decode(fs.readFileSync(path.join(__dirname, "../../assets/clob/contract.js")));