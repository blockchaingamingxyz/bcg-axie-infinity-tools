"use strict";

import * as fs from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import axieAbi from "./abi/axie.json" assert { type: "json" };
import Web3 from "web3";

const web3 = new Web3(
  new Web3.providers.HttpProvider("https://api.roninchain.com/rpc")
);
const AXIE_ADDRESS = web3.utils.toChecksumAddress(
  "0x32950db2a7164ae833121501c797d79e7b79d74c"
);
const axieContract = new web3.eth.Contract(axieAbi, AXIE_ADDRESS);
const GAS_LIMIT = 1000000;
const SECRETS_FILE = "secrets.csv";
const TRANSFER_FILE = "transfers.csv";
const RESULTS_FILE = "results.csv";

const transferAxies = async () => {
  const secretsData = await fs.readFileSync(SECRETS_FILE);
  const secrets = await parse(secretsData, {
    columns: true,
    skip_empty_lines: true,
  });
  const transferData = await fs.readFileSync(TRANSFER_FILE);
  const transfers = await parse(transferData, {
    columns: true,
    skip_empty_lines: true,
  });
  const results = [];

  console.log("Transfers Starting...");

  for (let transfer of transfers) {
    try {
      const { AccountAddress, AxieId, ReceiverAddress } = transfer;
      if (AccountAddress && AxieId && ReceiverAddress) {
        const accountSecret = secrets.find(
          (account) => account.accountAddress === AccountAddress
        );
        const privateKey = accountSecret?.accountPrivateKey;

        if (privateKey == null) throw "Missing private key";

        const formattedAddress = AccountAddress.replace("ronin:", "0x");
        const formattedReceiver = ReceiverAddress.replace("ronin:", "0x");
        const formattedAxieId = parseInt(AxieId, 10);
        const giftAxieResult = await giftAxie(
          formattedAddress,
          privateKey,
          formattedReceiver,
          formattedAxieId
        );
        const result = {
          ...transfer,
          Result: giftAxieResult,
        };
        results.push(result);
      } else {
        throw "Missing AccountAddress or AxieId or ReceiverAddress";
      }
    } catch (e) {
      const result = {
        ...transfer,
        Result: e,
      };
      results.push(result);
    }
  }

  const resultsData = await stringify(results, { header: true });
  await fs.writeFileSync(RESULTS_FILE, resultsData);
  console.log("Transfers Finished!");
};

const giftAxie = async (
  accountAddress,
  privateKey,
  recipientAddress,
  axieId
) => {
  try {
    console.log(`Attempting to tranfer ${axieId}`);
    const estimatedGas = await axieContract.methods
      .safeTransferFrom(accountAddress, recipientAddress, axieId)
      .estimateGas({ gas: GAS_LIMIT, from: accountAddress });

    if (estimatedGas === GAS_LIMIT) {
      console.log(`Method ran out of gas for ${axieId}`);
      return "Method ran out of gas";
    }

    const txCount = await web3.eth.getTransactionCount(accountAddress);
    const myData = axieContract.methods
      .safeTransferFrom(accountAddress, recipientAddress, axieId)
      .encodeABI();
    const txObject = {
      chainId: 2020,
      nonce: txCount,
      gas: web3.utils.toHex(estimatedGas),
      gasPrice: web3.utils.toHex(web3.utils.toWei("1", "gwei")),
      to: AXIE_ADDRESS,
      data: myData,
    };
    const signedTx = await web3.eth.accounts.signTransaction(
      txObject,
      privateKey
    );
    const raw = signedTx["rawTransaction"];
    const transaction = await web3.eth.sendSignedTransaction(raw);

    return transaction;
  } catch (error) {
    console.log(`Error gifting ${axieId}`, error);
    return error;
  }
};

transferAxies();
