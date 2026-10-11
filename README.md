# NeuroDrop

An on-chain dead-man's switch on **BOT Chain**. Escrow BOT + a message with a beneficiary and an interval. Check in before the timer runs out or anyone can trigger the release.

## Deploy

```bash
npm install
cp .env.example .env         # add your PRIVATE_KEY
npx hardhat test
npm run deploy:testnet       # or deploy:mainnet
```

Update `CONTRACT_ADDRESS` in `frontend/index.html`, then `vercel deploy` (or open `frontend/index.html` locally).

## Security note

Messages are stored **in plaintext on-chain** and are publicly readable from the moment a drop is armed. NeuroDrop is a legacy/anti-loss tool, not a secrecy tool — do not store secrets, seed phrases, or credentials in the message field.
