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
var ensureValidTransfer = async (tokenID, transferTx) => {
  await ensureValidInteraction(tokenID, transferTx);
  try {
    const tx = await SmartWeave.unsafeClient.transactions.get(transferTx);
    tx.get("tags").forEach((tag) => {
      if (tag.get("name", {decode: true, string: true}) === "Input") {
        const input = JSON.parse(tag.get("value", {decode: true, string: true}));
        ContractAssert(input.function === "transfer", "The interaction is not a transfer");
        ContractAssert(input.target === SmartWeave.transaction.tags.find(({name}) => name === "Contract").value, "The target of this transfer is not this contract");
      }
    });
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

// src/clob/modules/setCommunityContract.ts
var SetCommunityContract = (state, action) => {
  const caller = action.caller;
  const {id} = action.input;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot set the community contract");
  ContractAssert(isAddress(id), "Invalid ID supplied");
  return {...state, communityContract: id};
};

// src/clob/modules/foreignTransfer.ts
var ForeignTransfer = (state, action) => {
  const caller = action.caller;
  const input = action.input;
  ContractAssert(caller === state.emergencyHaltWallet, "Caller cannot issue a foreign transfer");
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
  const pairIndex = pairs.findIndex(({pair}) => pair.includes(usedPair[0]) && pair.includes(usedPair[1]));
  ContractAssert(pairIndex !== void 0, "This pair does not exist yet");
  let contractID = "", contractInput, transferTx;
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
  ContractAssert(typeof contractID === "string", "Invalid contract ID: not a string");
  ContractAssert(contractID !== "", "No contract ID found in the transfer transaction");
  const fromToken = usedPair[0];
  ContractAssert(fromToken === contractID, "Invalid transfer transaction, using the wrong token. The transferred token has to be the first item in the pair");
  ContractAssert(isAddress(contractID), "Invalid contract ID format");
  await ensureValidTransfer(contractID, tokenTx);
  let sortedOrderbook = state.pairs[pairIndex].orders.sort((a, b) => a.price > b.price ? 1 : -1);
  const {orderbook, foreignCalls} = matchOrder(contractID, contractInput.qty, caller, SmartWeave.transaction.id, tokenTx, sortedOrderbook, price);
  state.pairs[pairIndex].orders = orderbook;
  state.pairs[pairIndex].priceLogs = {
    orderID: SmartWeave.transaction.id,
    token: fromToken,
    logs: []
  };
  for (let i = 0; i < foreignCalls.length; i++) {
    state.foreignCalls.push(foreignCalls[i]);
  }
  return state;
};
function matchOrder(inputToken, inputQuantity, inputCreator, inputTransaction, inputTransfer, orderbook, inputPrice, foreignCalls = [], logs = []) {
  const orderPushed = !!orderbook.find((order) => order.id === inputTransaction);
  let fillAmount;
  if (orderbook.filter((order) => inputToken !== order.token && order.id !== inputTransaction).length === 0) {
    ContractAssert(!!inputPrice, "Input price should be defined for the first order to a pair");
    if (orderPushed) {
      return {
        orderbook,
        foreignCalls
      };
    }
    return {
      orderbook: [
        ...orderbook,
        {
          id: inputTransaction,
          transfer: inputTransfer,
          creator: inputCreator,
          token: inputToken,
          price: inputPrice,
          quantity: inputQuantity,
          originalQuantity: inputQuantity
        }
      ],
      foreignCalls
    };
  }
  for (let i = 0; i < orderbook.length; i++) {
    if (inputToken === orderbook[i].token)
      continue;
    if (orderbook[i].id === inputTransaction)
      continue;
    const convertedExistingPrice = 1 / orderbook[i].price;
    if (inputPrice) {
      console.log("1) LIMIT ORDER");
      ContractAssert(typeof inputPrice === "number", "Invalid price: not a number");
      fillAmount = inputQuantity * inputPrice;
    } else {
      console.log("2) MARKET ORDER");
      fillAmount = inputQuantity * convertedExistingPrice;
    }
    if (inputPrice === convertedExistingPrice || !inputPrice) {
      console.log("3) Found compatible order");
      console.log(orderbook[i]);
      if (fillAmount === orderbook[i].quantity) {
        console.log("4) ~~ Matched orders completely filled ~~");
        const sendAmount = orderbook[i].quantity;
        foreignCalls.push({
          txID: SmartWeave.transaction.id,
          contract: inputToken,
          input: {
            function: "transfer",
            target: orderbook[i].creator,
            qty: inputQuantity
          }
        }, {
          txID: SmartWeave.transaction.id,
          contract: orderbook[i].token,
          input: {
            function: "transfer",
            target: inputCreator,
            qty: sendAmount
          }
        });
        logs.push({
          id: orderbook[i].id,
          price: inputPrice || convertedExistingPrice,
          qty: sendAmount
        });
        orderbook.splice(i - 1, 1);
        return {
          orderbook,
          foreignCalls,
          logs
        };
      } else if (fillAmount < orderbook[i].quantity) {
        console.log("5) ~~ Input order filled; existing order not completely filled ~~");
        foreignCalls.push({
          txID: SmartWeave.transaction.id,
          contract: inputToken,
          input: {
            function: "transfer",
            target: orderbook[i].creator,
            qty: inputQuantity
          }
        }, {
          txID: SmartWeave.transaction.id,
          contract: orderbook[i].token,
          input: {
            function: "transfer",
            target: inputCreator,
            qty: fillAmount
          }
        });
        logs.push({
          id: orderbook[i].id,
          price: inputPrice || convertedExistingPrice,
          qty: fillAmount
        });
        orderbook[i].quantity -= fillAmount;
        return {
          orderbook,
          foreignCalls,
          logs
        };
      } else if (fillAmount > orderbook[i].quantity) {
        console.log("6) ~~ Input order not completely filled; existing order filled ~~");
        const sendAmount = orderbook[i].quantity;
        foreignCalls.push({
          txID: SmartWeave.transaction.id,
          contract: inputToken,
          input: {
            function: "transfer",
            target: orderbook[i].creator,
            qty: inputQuantity - sendAmount * convertedExistingPrice
          }
        }, {
          txID: SmartWeave.transaction.id,
          contract: orderbook[i].token,
          input: {
            function: "transfer",
            target: inputCreator,
            qty: sendAmount
          }
        });
        logs.push({
          id: orderbook[i].id,
          price: inputPrice || convertedExistingPrice,
          qty: sendAmount
        });
        console.log("INPUT QUANTITY", inputQuantity);
        console.log("ORDERBOOK ORDER QUANTITY", orderbook[i].quantity);
        console.log("CONVERTED EXISTING PRICE", convertedExistingPrice);
        if (!orderPushed) {
          console.log("NOT ORDER PUSHED");
          orderbook.push({
            id: inputTransaction,
            transfer: inputTransfer,
            creator: inputCreator,
            token: inputToken,
            price: convertedExistingPrice,
            quantity: inputQuantity - orderbook[i].quantity * convertedExistingPrice,
            originalQuantity: inputQuantity
          });
        } else {
          const order = orderbook.find((order2) => order2.id === inputTransaction);
          console.log(order.quantity - orderbook[i].quantity * convertedExistingPrice);
          order.quantity -= orderbook[i].quantity * convertedExistingPrice;
        }
        orderbook = orderbook.filter((order) => order.id !== orderbook[i].id);
        console.log("7) Calling recursively");
        return matchOrder(inputToken, inputQuantity, inputCreator, inputTransaction, inputTransfer, orderbook, convertedExistingPrice, foreignCalls, logs);
      }
    }
  }
  if (orderPushed) {
    return {
      orderbook,
      foreignCalls,
      logs
    };
  }
  return {
    orderbook: [
      ...orderbook,
      {
        id: inputTransaction,
        transfer: inputTransfer,
        creator: inputCreator,
        token: inputToken,
        price: inputPrice,
        quantity: inputQuantity,
        originalQuantity: inputQuantity
      }
    ],
    foreignCalls,
    logs
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
    priceLogs: null,
    orders: []
  });
  return state;
};

// src/clob/modules/invoke.ts
var Invoke = async (state, action) => {
  const input = action.input;
  ContractAssert(!!input.invocation, "Missing function invocation");
  ContractAssert(!!input.foreignContract, "Missing foreign contract ID");
  state.foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: input.foreignContract,
    input: input.invocation
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
      return {state: await CreateOrder(state, action)};
    case "cancelOrder":
      return {state: await CancelOrder(state, action)};
    case "readOutbox":
      return {state: await ReadOutbox(state, action)};
    case "invoke":
      return {state: await Invoke(state, action)};
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
