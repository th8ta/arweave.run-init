/*
 * 
 * MIT License
 * 
 * Copyright (c) 2021- The Verto Protocol
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 * 
 */

// src/clob/modules/togglePairGatekeeper.ts
var TogglePairGatekeeper = (state, action) => {
  const caller = action.caller;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot toggle the gatekeeper");
  return {...state, pairGatekeeper: !state.pairGatekeeper};
};

// src/clob/utils.ts
var ensureValidTransfer = async (tokenID, transferTx, caller) => {
  await ensureValidInteraction(tokenID, transferTx);
  try {
    const tx = await SmartWeave.unsafeClient.transactions.get(transferTx);
    tx.get("tags").forEach((tag) => {
      if (tag.get("name", {decode: true, string: true}) === "Input") {
        const input = JSON.parse(tag.get("value", {decode: true, string: true}));
        ContractAssert(input.function === "transfer", "The interaction is not a transfer");
        ContractAssert(input.target === getContractID(), "The target of this transfer is not this contract");
        ContractAssert(input.qty && input.qty > 0, "Invalid transfer quantity");
      }
    });
    const transferOwner = tx.get("owner");
    const transferOwnerAddress = await SmartWeave.unsafeClient.wallets.ownerToAddress(transferOwner);
    ContractAssert(transferOwnerAddress === caller, "Transfer owner is not the order creator");
  } catch (err) {
    throw new ContractError(err);
  }
};
var ensureValidInteraction = async (contractID, interactionID) => {
  const {
    validity: contractTxValidities
  } = await SmartWeave.contracts.readContractState(contractID, void 0, true);
  ContractAssert(interactionID in contractTxValidities, "The interaction is not associated with this contract");
  ContractAssert(contractTxValidities[interactionID], "The interaction was invalid");
};
var isAddress = (addr) => /[a-z0-9_-]{43}/i.test(addr);
function tagPatch(tags) {
  if (Array.isArray(tags))
    return tags;
  const constructedArray = [];
  for (const field in tags) {
    constructedArray.push({
      name: field,
      value: tags[field]
    });
  }
  return constructedArray;
}
function getContractID() {
  const tags = tagPatch(SmartWeave.transaction.tags);
  const id = tags.find(({name}) => name === "Contract").value;
  return id;
}

// src/clob/modules/setCommunityContract.ts
var SetCommunityContract = (state, action) => {
  const caller = action.caller;
  const {id} = action.input;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot set the community contract");
  ContractAssert(id !== getContractID(), "Cannot add self as community contract");
  ContractAssert(isAddress(id), "Invalid ID supplied");
  return {...state, communityContract: id};
};

// src/clob/modules/foreignTransfer.ts
var ForeignTransfer = (state, action) => {
  const caller = action.caller;
  const input = action.input;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot issue a foreign transfer");
  if (input.transfers) {
    for (let i = 0; i < input.transfers.length; i++) {
      const transfer = input.transfers[i];
      ContractAssert(transfer.qty && !!transfer.target && !!transfer.tokenID, `Missing parameters for transfer #${i}`);
      state.foreignCalls.push({
        txID: SmartWeave.transaction.id,
        contract: transfer.tokenID,
        input: {
          function: "transfer",
          target: transfer.target,
          qty: transfer.qty
        }
      });
    }
  } else {
    ContractAssert(input.qty && !!input.target && !!input.tokenID, "Missing parameters");
    state.foreignCalls.push({
      txID: SmartWeave.transaction.id,
      contract: input.tokenID,
      input: {
        function: "transfer",
        target: input.target,
        qty: input.qty
      }
    });
  }
  return state;
};

// src/clob/modules/createOrder.ts
var CreateOrder = async (state, action) => {
  const caller = action.caller;
  const input = action.input;
  const pairs = state.pairs;
  const usedPair = input.pair;
  const tokenTx = input.transaction;
  const price = input.price;
  ContractAssert(isAddress(usedPair[0]) && isAddress(usedPair[1]), "One of two supplied pairs is invalid");
  ContractAssert(price === void 0 || price === null || price > 0, "Price must be greater than 0");
  let contractID = "";
  let contractInput;
  let transferTx;
  try {
    transferTx = await SmartWeave.unsafeClient.transactions.get(tokenTx);
  } catch (err) {
    throw new ContractError(err);
  }
  transferTx.get("tags").forEach((tag) => {
    if (tag.get("name", {decode: true, string: true}) === "Contract") {
      contractID = tag.get("value", {decode: true, string: true});
    }
    if (tag.get("name", {decode: true, string: true}) === "Input") {
      contractInput = JSON.parse(tag.get("value", {decode: true, string: true}));
    }
  });
  ContractAssert(typeof contractID === "string", "Invalid contract ID in transfer: not a string");
  ContractAssert(contractID !== "", "No contract ID found in the transfer transaction");
  ContractAssert(!state.usedTransfers.includes(tokenTx), "This transfer has already been used for an order");
  ContractAssert(isAddress(contractID), "Invalid contract ID format");
  await ensureValidTransfer(contractID, tokenTx, caller);
  const refundTransfer = () => state.foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: contractID,
    input: {
      function: "transfer",
      target: caller,
      qty: contractInput.qty
    }
  });
  const fromToken = usedPair[0];
  if (fromToken !== contractID) {
    refundTransfer();
    return {
      state,
      result: {
        status: "failure",
        message: "Invalid transfer transaction, using the wrong token. The transferred token has to be the first item in the pair"
      }
    };
  }
  const pairIndex = pairs.findIndex(({pair}) => pair.includes(usedPair[0]) && pair.includes(usedPair[1]));
  if (pairIndex === -1) {
    refundTransfer();
    return {
      state,
      result: {
        status: "failure",
        message: "This pair does not exist yet"
      }
    };
  }
  const sortedOrderbook = state.pairs[pairIndex].orders.sort((a, b) => a.price > b.price ? 1 : -1);
  const dominantToken = state.pairs[pairIndex].pair[0];
  try {
    const {orderbook, foreignCalls, matches} = matchOrder({
      pair: {
        dominant: dominantToken,
        from: contractID,
        to: usedPair.find((val) => val !== contractID)
      },
      quantity: contractInput.qty,
      creator: caller,
      transaction: SmartWeave.transaction.id,
      transfer: tokenTx,
      price
    }, sortedOrderbook);
    state.pairs[pairIndex].orders = orderbook;
    if (matches.length > 0) {
      const vwap = matches.map(({qty: volume, price: price2}) => volume * price2).reduce((a, b) => a + b, 0) / matches.map(({qty: volume}) => volume).reduce((a, b) => a + b, 0);
      state.pairs[pairIndex].priceData = {
        dominantToken,
        block: SmartWeave.block.height,
        vwap,
        matchLogs: matches
      };
    } else {
      state.pairs[pairIndex].priceData = void 0;
    }
    for (let i = 0; i < foreignCalls.length; i++) {
      state.foreignCalls.push(foreignCalls[i]);
    }
    state.usedTransfers.push(tokenTx);
    return {
      state,
      result: {
        status: "success",
        message: "Order created successfully"
      }
    };
  } catch (e) {
    refundTransfer();
    return {
      state,
      result: {
        status: "failure",
        message: e.message
      }
    };
  }
};
function matchOrder(input, orderbook) {
  const orderType = input.price ? "limit" : "market";
  const foreignCalls = [];
  const matches = [];
  const reverseOrders = orderbook.filter((order) => input.pair.from !== order.token && order.id !== input.transaction);
  if (!reverseOrders.length) {
    if (orderType !== "limit")
      throw new Error('The first order for a pair can only be a "limit" order');
    orderbook.push({
      id: input.transaction,
      transfer: input.transfer,
      creator: input.creator,
      token: input.pair.from,
      price: input.price,
      quantity: input.quantity,
      originalQuantity: input.quantity
    });
    return {
      orderbook,
      foreignCalls,
      matches
    };
  }
  let fillAmount;
  let receiveAmount = 0;
  let remainingQuantity = input.quantity;
  for (let i = 0; i < orderbook.length; i++) {
    const currentOrder = orderbook[i];
    if (input.pair.from === currentOrder.token || currentOrder.id === input.transaction)
      continue;
    const reversePrice = 1 / currentOrder.price;
    if (orderType === "limit" && input.price !== reversePrice)
      continue;
    fillAmount = remainingQuantity * (input.price ?? reversePrice);
    let receiveFromCurrent = 0;
    if (fillAmount <= currentOrder.quantity) {
      receiveFromCurrent = remainingQuantity * reversePrice;
      currentOrder.quantity -= fillAmount;
      receiveAmount += receiveFromCurrent;
      if (remainingQuantity > 0) {
        foreignCalls.push({
          txID: SmartWeave.transaction.id,
          contract: input.pair.from,
          input: {
            function: "transfer",
            target: currentOrder.creator,
            qty: remainingQuantity
          }
        });
      }
      remainingQuantity = 0;
    } else {
      receiveFromCurrent = currentOrder.quantity;
      receiveAmount += receiveFromCurrent;
      const sendAmount = receiveFromCurrent * currentOrder.price;
      remainingQuantity -= sendAmount;
      foreignCalls.push({
        txID: SmartWeave.transaction.id,
        contract: input.pair.from,
        input: {
          function: "transfer",
          target: currentOrder.creator,
          qty: sendAmount
        }
      });
      currentOrder.quantity = 0;
    }
    let dominantPrice = 0;
    if (input.pair.dominant === input.pair.from) {
      dominantPrice = input.price ?? reversePrice;
    } else {
      dominantPrice = currentOrder.price;
    }
    matches.push({
      id: currentOrder.id,
      qty: receiveFromCurrent,
      price: dominantPrice
    });
    if (currentOrder.quantity === 0) {
      orderbook = orderbook.filter((val) => val.id !== currentOrder.id);
    }
    if (remainingQuantity === 0)
      break;
  }
  if (remainingQuantity > 0) {
    if (orderType === "limit") {
      orderbook.push({
        id: input.transaction,
        transfer: input.transfer,
        creator: input.creator,
        token: input.pair.from,
        price: input.price,
        quantity: remainingQuantity,
        originalQuantity: input.quantity
      });
    } else {
      foreignCalls.push({
        txID: SmartWeave.transaction.id,
        contract: input.pair.from,
        input: {
          function: "transfer",
          target: input.creator,
          qty: remainingQuantity
        }
      });
    }
  }
  foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: input.pair.to,
    input: {
      function: "transfer",
      target: input.creator,
      qty: receiveAmount
    }
  });
  return {
    orderbook,
    foreignCalls,
    matches
  };
}

// src/clob/modules/cancelOrder.ts
var CancelOrder = async (state, action) => {
  const caller = action.caller;
  const input = action.input;
  const orderTxID = input.orderID;
  ContractAssert(isAddress(orderTxID), "Invalid order ID");
  const allOrders = state.pairs.map((pair) => pair.orders).flat(1);
  const order = allOrders.find(({id}) => id === orderTxID);
  ContractAssert(order !== void 0, "Order does not exist");
  ContractAssert(order.creator === caller, "Caller is not the creator of the order");
  state.foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: order.token,
    input: {
      function: "transfer",
      target: caller,
      qty: order.quantity
    }
  });
  const acitvePair = state.pairs.find((pair) => pair.orders.find(({id}) => id === orderTxID));
  acitvePair.orders = acitvePair.orders.filter(({id}) => id !== orderTxID);
  return state;
};

// src/clob/modules/readOutbox.ts
var ReadOutbox = async (state, action) => {
  const input = action.input;
  ContractAssert(!!input.contract, "Missing contract to invoke");
  ContractAssert(input.contract !== getContractID(), "Cannot read own outbox");
  const foreignState = await SmartWeave.contracts.readContractState(input.contract);
  ContractAssert(!!foreignState.foreignCalls, "Contract is missing support for foreign calls");
  const calls = foreignState.foreignCalls.filter((element) => element.contract === SmartWeave.contract.id && !state.invocations.includes(element.txID));
  let res = state;
  for (const entry of calls) {
    res = (await handle(res, {caller: input.contract, input: entry.input})).state;
    res.invocations.push(entry.txID);
  }
  return res;
};

// src/clob/modules/addPair.ts
var AddPair = async (state, action) => {
  const caller = action.caller;
  const input = action.input;
  const pairs = state.pairs;
  const communityContract = state.communityContract;
  const gatekeeperActive = state.pairGatekeeper;
  const newPair = input.pair;
  ContractAssert(newPair.length === 2, "Invalid pair length. Should be 2");
  ContractAssert(newPair[0] !== getContractID() && newPair[1] !== getContractID(), "Cannot add self as a pair");
  ContractAssert(/[a-z0-9_-]{43}/i.test(newPair[0]) && /[a-z0-9_-]{43}/i.test(newPair[1]), "One of two supplied pairs is invalid");
  const communityState = await SmartWeave.contracts.readContractState(communityContract);
  ContractAssert(!!communityState.tokens.find(({id}) => id === newPair[0]), `${newPair[0]} is not listed on Verto`);
  ContractAssert(!!communityState.tokens.find(({id}) => id === newPair[1]), `${newPair[1]} is not listed on Verto`);
  if (gatekeeperActive) {
    ContractAssert(!!communityState.people.find((person) => person.addresses.includes(caller)), "No Verto ID linked to this address");
  }
  for (const id of newPair) {
    try {
      const tokenState = await SmartWeave.contracts.readContractState(id);
      ContractAssert(tokenState?.ticker && tokenState?.balances, "Contract is not a valid token");
      ContractAssert(typeof tokenState.ticker === "string", "Contract ticker is not a string");
      for (const addr in tokenState.balances) {
        ContractAssert(typeof tokenState.balances[addr] === "number", `Invalid balance for "${addr}" in contract "${id}"`);
      }
      const tradeableSetting = tokenState?.settings?.find(([settingName]) => settingName === "isTradeable")?.[1];
      ContractAssert(tradeableSetting === true || tradeableSetting === void 0, `This token does not allow trading (${id})`);
      ContractAssert(!!tokenState.invocations, 'Contract does not have an "invocations" filed, making it incompatible with FCP');
      ContractAssert(!!tokenState.foreignCalls, 'Contract does not have an "foreignCalls" filed, making it incompatible with FCP');
    } catch (e) {
      throw new ContractError(e);
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    const currentPair = pairs[i].pair;
    ContractAssert(!currentPair.includes(newPair[0]) && !currentPair.includes(newPair[1]), "This pair already exists");
  }
  state.pairs.push({
    pair: newPair,
    orders: []
  });
  return state;
};

// src/clob/modules/halt.ts
var Halt = (state, action) => {
  const caller = action.caller;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot halt or resume the protocol");
  return {...state, halted: !state.halted};
};

// src/clob/index.ts
export async function handle(state, action) {
  ContractAssert(!state.halted || action.input.function === "halt", "The contract is currently halted");
  switch (action.input.function) {
    case "addPair":
      return {state: await AddPair(state, action)};
    case "createOrder":
      return await CreateOrder(state, action);
    case "cancelOrder":
      return {state: await CancelOrder(state, action)};
    case "readOutbox":
      return {state: await ReadOutbox(state, action)};
    case "togglePairGatekeeper":
      return {state: TogglePairGatekeeper(state, action)};
    case "setCommunityContract":
      return {state: SetCommunityContract(state, action)};
    case "foreignTransfer":
      return {state: ForeignTransfer(state, action)};
    case "halt":
      return {state: Halt(state, action)};
    default:
      throw new ContractError(`Invalid function: "${action.input.function}"`);
  }
}
