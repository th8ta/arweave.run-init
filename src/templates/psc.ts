import path from "path";
import fs from "fs";

export const pscState = {
  "name": "My DAO Name",
  "ticker": "TOK",
  "balances": {
    "uhE-QeYS8i4pmUtnxQyHD7dzXFNaJ9oMK-IM-QPNY6M": 10000000
  },
  "vault": {
    "uhE-QeYS8i4pmUtnxQyHD7dzXFNaJ9oMK-IM-QPNY6M": [
      {
        "balance": 1000,
        "end": 100,
        "start": 0
      }
    ]
  },
  "votes": [],
  "roles": {},
  "settings": [
    ["quorum", 0.5],
    ["support", 0.5],
    ["voteLength", 2000],
    ["lockMinLength", 5],
    ["lockMaxLength", 720]
  ]
};

export const pscSource = new TextDecoder().decode(fs.readFileSync(path.join(__dirname, "../../assets/psc/contract.js")));