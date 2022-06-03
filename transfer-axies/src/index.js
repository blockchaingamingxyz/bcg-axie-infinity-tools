"use strict";

import * as fs from "fs";
import { parse } from "csv-parse/sync";
const batchABI = JSON.parse(
  fs.readFileSync("./abi/ERC721Batch.json").toString()
);
const axieABI = JSON.parse(fs.readFileSync("./abi/axie.json").toString());

import Web3 from "web3";
import "core-js";

const web3 = new Web3(
  new Web3.providers.HttpProvider("https://api.roninchain.com/rpc")
);
const BATCH_ADDRESS = web3.utils.toChecksumAddress(
  "0x2368dfED532842dB89b470fdE9Fd584d48D4F644"
);
const AXIE_ADDRESS = web3.utils.toChecksumAddress(
  "0x32950db2a7164ae833121501c797d79e7b79d74c"
);
const batchContract = new web3.eth.Contract(batchABI, BATCH_ADDRESS);
const axieContract = new web3.eth.Contract(axieABI, AXIE_ADDRESS);
const SECRETS_FILE = "../secrets.csv";
const TRANSFER_FILE = "../transfers.csv";
const RESULTS_FILE = "../results.csv";

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
  }).groupBy(({ AccountAddress }) => AccountAddress);
  const results = [];

  console.log("Transfers Starting...");

  for (const account in transfers) {
    const recipientAddresses = [];
    const axieIds = [];
    for (const transfer of transfers[account]) {
      const { AccountAddress, AxieId, ReceiverAddress } = transfer;
      if (AccountAddress && AxieId && ReceiverAddress) {
        recipientAddresses.push(ReceiverAddress.replace("ronin:", "0x"));
        axieIds.push(parseInt(AxieId, 10));
      } else {
        throw "Missing AccountAddress or AxieId or ReceiverAddress";
      }
    }
    try {
      const accountSecret = secrets.find(
        (accountk) => accountk.accountAddress === account
      );
      const privateKey = accountSecret?.accountPrivateKey;
      if (privateKey == null) throw "Missing private key";
      if (
        web3.eth.accounts.privateKeyToAccount(privateKey).address !==
        web3.utils.toChecksumAddress(account.replace("ronin:", "0x"))
      ) {
        throw "Private key is invalid or does not match account";
      }

      const batchTransferResult = await batchTransferAxie(
        account.replace("ronin:", "0x"),
        privateKey,
        recipientAddresses,
        axieIds
      );
      if (batchTransferResult.match("/error/i")) {
        throw batchTransferResult;
      }
      console.log(`✔ - ${account} => (${axieIds}) @ ${batchTransferResult}`);
      results.push(`✔ - ${account} => (${axieIds}) @ ${batchTransferResult}`);
    } catch (e) {
      console.log(
        `Transfer failed for ${account} due to the following error: ${e}`
      );
      results.push(`❌ - ${account} => (${axieIds}) ${e}`);
    }
  }

  await fs.writeFileSync(RESULTS_FILE, results.join("\n"));
  console.log("Transfers Finished!");
};

const batchTransferAxie = async (
  accountAddress,
  privateKey,
  recipientAddresses,
  axieIds
) => {
  try {
    let txCount = await web3.eth.getTransactionCount(accountAddress);

    if (
      (await axieContract.methods
        .isApprovedForAll(accountAddress, BATCH_ADDRESS)
        .call()) !== true
    ) {
      const myData = axieContract.methods
        .setApprovalForAll(BATCH_ADDRESS, true)
        .encodeABI();
      const txObject = {
        chainId: 2020,
        nonce: txCount,
        gas: web3.utils.toHex(100000),
        gasPrice: web3.utils.toHex(web3.utils.toWei("1", "gwei")),
        to: AXIE_ADDRESS,
        data: myData,
      };
      const signedTx = await web3.eth.accounts.signTransaction(
        txObject,
        privateKey
      );
      const raw = signedTx["rawTransaction"];
      await web3.eth.sendSignedTransaction(raw);
    }
    console.log(`Attempting to transfer ${axieIds}`);
    const estimatedGas = await batchContract.methods[
      "safeBatchTransfer(address,uint256[],address[])"
    ](AXIE_ADDRESS, axieIds, recipientAddresses).estimateGas({
      from: accountAddress,
    });

    txCount = await web3.eth.getTransactionCount(accountAddress);

    const myData = batchContract.methods[
      "safeBatchTransfer(address,uint256[],address[])"
    ](AXIE_ADDRESS, axieIds, recipientAddresses).encodeABI();
    const txObject = {
      chainId: 2020,
      nonce: txCount,
      gas: web3.utils.toHex(estimatedGas),
      gasPrice: web3.utils.toHex(web3.utils.toWei("1", "gwei")),
      to: BATCH_ADDRESS,
      data: myData,
    };
    const signedTx = await web3.eth.accounts.signTransaction(
      txObject,
      privateKey
    );
    const raw = signedTx["rawTransaction"];
    return (await web3.eth.sendSignedTransaction(raw))["transactionHash"];
  } catch (error) {
    console.log(`Error transferring ${axieIds}`, error);
    return error;
  }
};

transferAxies();
