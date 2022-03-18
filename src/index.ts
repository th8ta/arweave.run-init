import { nftSource, nftState } from "./templates/nft";

import Arweave from "arweave";

const client = new Arweave({
  host: "arweave.run",
  port: 443,
  protocol: "http"
});

(async () => {
  console.log(nftSource, nftState)
})();