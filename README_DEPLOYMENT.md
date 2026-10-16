# 📚 Fundit.fun Deployment Documentation

Welcome! This directory contains all the documentation and files needed to deploy Fundit.fun to production using cPanel hosting.

## 📖 Documentation Files

### 1. **DEPLOYMENT_GUIDE.md** ⭐ START HERE
   - **Comprehensive step-by-step guide**
   - Detailed instructions for every aspect of deployment
   - Troubleshooting section
   - Security checklist
   - **Read this first for complete understanding**

### 2. **QUICK_START_DEPLOYMENT.md** ⚡ FAST TRACK
   - Condensed version for experienced developers
   - Quick reference for common tasks
   - Estimated time: ~55 minutes
   - Use this if you're familiar with cPanel/Node.js

### 3. **DEPLOYMENT_CHECKLIST.md** ✅ TRACK PROGRESS
   - Step-by-step checklist
   - Use during deployment to track progress
   - Includes testing and verification steps
   - Print or keep open while deploying

## 📁 Configuration Files

### Backend
- `backend/env.template` - Environment variables template
- `backend/ecosystem.config.js` - PM2 configuration (if using PM2)
- `backend/.env` - **Create this from template** (not in Git)

### Frontend
- `frontend/env.production.template` - Frontend environment template
- `frontend/.env.production` - **Create this from template** (not in Git)

### Web Server
- `public_html/.htaccess` - Apache configuration for SPA routing and HTTPS

### Scripts
- `cpanel-setup-script.sh` - Automated setup script (optional)

## 🚀 Quick Start

### For First-Time Deployment:
1. Read `DEPLOYMENT_GUIDE.md` completely
2. Use `DEPLOYMENT_CHECKLIST.md` to track progress
3. Follow steps in order

### For Experienced Developers:
1. Skim `QUICK_START_DEPLOYMENT.md`
2. Use `DEPLOYMENT_CHECKLIST.md` as reference
3. Refer to `DEPLOYMENT_GUIDE.md` for details when needed

## 📋 Pre-Deployment Requirements

Before starting, ensure you have:

- [ ] Domain with DNS pointing to Cloudflare
- [ ] cPanel hosting with Node.js (>=23.8.0) and PostgreSQL
- [ ] All smart contracts deployed and verified
- [ ] Contract addresses for all chains
- [ ] RPC URLs for all blockchain networks
- [ ] Firebase Storage credentials
- [ ] Reown (WalletConnect) Project ID
- [ ] Master seed phrase for wallet generation (keep secure!)

## 🔧 Setup Process Overview

```
1. Database Setup (PostgreSQL)
   ↓
2. Backend Deployment (Node.js API)
   ↓
3. Frontend Deployment (React Build)
   ↓
4. SSL & Domain Configuration
   ↓
5. Process Management (Workers)
   ↓
6. Testing & Verification
   ↓
7. Monitoring & Maintenance
```

## 📝 Environment Variables

### Backend (.env)
```bash
DATABASE_URL=postgresql://...
POLYGON_RPC=...
POLYGON_CONTRACT_ADDRESS=...
# ... all other chains
WALLET_MASTER_SEED=...  # KEEP SECRET!
CORS_ORIGIN=https://yourdomain.com
```

### Frontend (.env.production)
```bash
VITE_APP_API_URL=https://api.yourdomain.com
VITE_PROJECT_ID=your-reown-id
```

**Important:** 
- Copy from templates (`env.template` and `env.production.template`)
- Never commit `.env` files to Git
- Rebuild frontend after changing `.env.production`

## 🗂️ Project Structure

```
fundit/
├── backend/              # Node.js API & Indexer
│   ├── .env            # Environment variables (create from template)
│   ├── index.js        # API server entry point
│   ├── worker.js       # Block indexing worker
│   ├── logs/           # Application logs
│   └── ...
├── frontend/           # React application
│   ├── .env.production # Frontend env vars (create from template)
│   ├── dist/           # Build output (upload to public_html)
│   └── ...
├── contracts/          # Smart contracts
├── public_html/        # Web server document root
│   ├── .htaccess      # Apache configuration
│   └── ...            # Frontend build files
└── DEPLOYMENT_*.md     # This documentation
```

## 🔐 Security Notes

1. **Never commit `.env` files** - They contain secrets
2. **Set file permissions:**
   ```bash
   chmod 600 backend/.env
   chmod 600 frontend/.env.production
   ```
3. **Keep `WALLET_MASTER_SEED` extremely secure** - This generates campaign wallets
4. **Use strong database passwords**
5. **Enable SSL/HTTPS** - Required for production
6. **Configure CORS correctly** - Only allow your domain

## 🧪 Testing After Deployment

```bash
# Test API health
curl https://api.yourdomain.com/api/health

# Test campaigns endpoint
curl https://api.yourdomain.com/api/campaigns?limit=5

# Check logs
tail -f ~/fundit-backend/logs/combined.log
tail -f ~/fundit-backend/logs/error.log
```

## 🆘 Getting Help

### Common Issues:
- See **Troubleshooting** section in `DEPLOYMENT_GUIDE.md`
- Check logs in `backend/logs/`
- Verify environment variables are set correctly

### Support Resources:
- **Full Guide:** `DEPLOYMENT_GUIDE.md`
- **Quick Reference:** `QUICK_START_DEPLOYMENT.md`
- **cPanel Docs:** Your hosting provider's documentation
- **Cloudflare Docs:** https://developers.cloudflare.com

## 📊 Post-Deployment Checklist

After deployment, verify:

- [ ] API responds at `/api/health`
- [ ] Frontend loads without console errors
- [ ] Database migrations completed
- [ ] Worker processing blocks (check logs)
- [ ] SSL certificate valid
- [ ] Wallet connection works
- [ ] Test campaign creation (testnet first!)
- [ ] Test donations (testnet first!)
- [ ] Monitor logs for 24-48 hours

## 🔄 Updates & Maintenance

### Regular Tasks:
- **Daily:** Check error logs
- **Weekly:** Run reconciliation (`npm run reconcile`)
- **Monthly:** Update dependencies, review logs, backup database

### Updating Code:
1. Pull latest changes (if using Git)
2. Update environment variables if needed
3. Install dependencies: `npm install --production`
4. Rebuild frontend: `npm run build` (if changed)
5. Restart Node.js app in cPanel
6. Test thoroughly

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section in `DEPLOYMENT_GUIDE.md`
2. Review logs in `backend/logs/`
3. Verify all environment variables
4. Contact your hosting provider for cPanel-specific issues

---

## 🎯 Deployment Time Estimates

- **First-time deployment:** 2-3 hours (with reading documentation)
- **Experienced developer:** 45-60 minutes
- **Updates/maintenance:** 10-15 minutes

---

**Good luck with your deployment! 🚀**

Start with `DEPLOYMENT_GUIDE.md` for detailed instructions.
