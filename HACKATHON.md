# AgentArbiter - Hackathon Submission Guide

## شبکه‌ی درخواستی: Studio Next (chain 61997)

- RPC: `https://studio-dev.genlayer.com/api`
- Chain ID: `61997`
- Explorer: `https://explorer-studio-dev.genlayer.com`

```bash
cd frontend
npm install
node scripts/deploy.mjs                    # آدرس قرارداد و هش تراکنش deploy را چاپ می‌کند
node scripts/smoke.mjs <contract-address>  # کل چرخه + هش تراکنش settle (اجماع validatorها)
```

سپس در `frontend/.env.local`:

```
VITE_NETWORK=studionext
VITE_CONTRACT_ADDRESS=<آدرس>
```

و `npm run build` و پوشه‌ی `dist/` را روی Vercel/Netlify منتشر کنید.
آدرس قرارداد، هش‌ها، لینک اپ و لینک ویدیوی دمو را در جدول بالای `README.md` بگذارید.

## راه اصلی: Testnet Bradbury

### مرحله ۱: حساب بسازید
```bash
# نصب genlayer CLI
npm install -g genlayer@latest

# ساخت حساب جدید
genlayer account create
```

یا از MetaMask استفاده کنید:
- chain id: 4221
- RPC: https://rpc-bradbury.genlayer.com

### مرحله ۲: GEN تهیه کنید
- فاست: https://testnet-faucet.genlayer.foundation
- آدرس حساب خود را وارد کنید
- ۱۰۰+ GEN رایگان دریافت کنید

### مرحله ۳: Deploy کنید
```bash
# از طریق genlayer CLI
genlayer network    # Bradbury را انتخاب کنید
genlayer deploy

# یا از طریق JavaScript
node scripts/deploy.mjs  # با اتصال به testnet
```

### مرحله ۴: در Agent Tank ثبت کنید
- آدرس قرارداد را کپی کنید
- به https://portal.genlayer.foundation/agent-tank/hackathon برو
- ثبت‌نام کنید

## نکته مهم
پروژه **کاملاً آماده** است. فقط نیاز به یک شبکه واقعی + حساب با GEN دارد.
