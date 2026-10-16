# 🚀 Quick Start Deployment Guide - Fundit.fun

This is a condensed version for experienced developers. For detailed instructions, see `DEPLOYMENT_GUIDE.md`.

## Prerequisites Checklist
- [ ] Domain DNS → Cloudflare
- [ ] cPanel access (Node.js + PostgreSQL)
- [ ] Contract addresses ready
- [ ] RPC URLs ready
- [ ] Firebase credentials
- [ ] Reown Project ID
- [ ] Master seed phrase (secure!)

---

## 1. Database Setup (5 min)

```bash
# In cPanel:
1. PostgreSQL Databases → Create Database: fundit_db
2. Create User: fundit_user (strong password!)
3. Add User to Database → ALL PRIVILEGES
4. Note connection string format:
   postgresql://username_fundit_user:password@localhost:5432/username_fundit_db
```

---

## 2. Backend Deployment (15 min)

### Upload Code
```bash
# Option A: Git in cPanel
cPanel → Git Version Control → Clone your repo to /home/username/fundit-backend

# Option B: FTP/File Manager
Upload backend folder → Extract to /home/username/fundit-backend
```

### Setup Node.js App
```bash
# In cPanel:
1. Node.js App → Create Application
2. Node Version: Latest (>=23.8.0)
3. Application Root: /home/username/fundit-backend
4. Startup File: index.js
5. Create → Start App
```

### Configure Environment
```bash
# SSH or File Manager:
cd ~/fundit-backend
nano .env  # Copy from .env.example and fill values

# Required variables:
DATABASE_URL=postgresql://...
POLYGON_RPC=...
POLYGON_CONTRACT_ADDRESS=...
# ... all other RPCs and contracts
WALLET_MASTER_SEED=...
CORS_ORIGIN=https://yourdomain.com

chmod 600 .env
npm install --production
mkdir -p logs
```

### Run Migrations
```bash
cd ~/fundit-backend
npm run migrate
# OR
node migrations/runner.js
```

---

## 3. Frontend Deployment (10 min)

### Build Locally (Recommended)
```bash
cd frontend
cp .env.production.example .env.production
# Edit .env.production:
# VITE_APP_API_URL=https://api.yourdomain.com
# VITE_PROJECT_ID=your-reown-id

npm install
npm run build
```

### Upload Build
```bash
# Upload dist/ folder contents to:
/home/username/public_html/

# Upload .htaccess from public_html/.htaccess
```

---

## 4. SSL & Domain (10 min)

### Cloudflare
```
SSL/TLS → Overview → Full (strict)
SSL/TLS → Edge Certificates → Always Use HTTPS: ON
```

### cPanel SSL
```
SSL/TLS Status → Install Let's Encrypt
OR
SSL/TLS → Manage SSL Sites → Upload Cloudflare Origin Certificate
```

### DNS Records (Cloudflare)
```
A     @     your-server-ip    Proxied
A     api   your-server-ip   Proxied (or DNS only)
CNAME www   yourdomain.com   Proxied
```

---

## 5. Process Management (10 min)

### API (cPanel Node.js App)
```
Node.js App → Your App → Start App
```

### Worker (Cron Job)
```
cPanel → Cron Jobs → Add New

Every 5 minutes:
cd /home/username/fundit-backend && /path/to/node worker.js >> logs/worker.log 2>&1

# Find node path:
# Node.js App → Your App → Check "Node.js version" path
```

### Donation Monitor (Cron Job)
```
Every 2 minutes:
cd /home/username/fundit-backend && /path/to/node scripts/monitor-donations.js >> logs/monitor.log 2>&1
```

---

## 6. Testing (5 min)

```bash
# Test API
curl https://api.yourdomain.com/api/health
curl https://api.yourdomain.com/api/campaigns?limit=5

# Test Frontend
Open: https://yourdomain.com
Check browser console for errors

# Check Logs
tail -f ~/fundit-backend/logs/combined.log
tail -f ~/fundit-backend/logs/error.log
```

---

## Environment Variables Quick Reference

### Backend (.env)
```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
POLYGON_RPC=...
POLYGON_CONTRACT_ADDRESS=...
ETH_RPC=...
ETH_CONTRACT_ADDRESS=...
# ... all other chains
WALLET_MASTER_SEED=...
CORS_ORIGIN=https://yourdomain.com
```

### Frontend (.env.production)
```bash
VITE_APP_API_URL=https://api.yourdomain.com
VITE_PROJECT_ID=your-reown-id
```

---

## Common Issues & Quick Fixes

### Database Connection Failed
```bash
# Test connection
psql -U username_fundit_user -d username_fundit_db -h localhost

# Check .env DATABASE_URL format
# Check user permissions in cPanel
```

### API Not Accessible
```bash
# Check Node.js app is started in cPanel
# Check port in .env matches Node.js app port
# Check firewall/Cloudflare proxy settings
```

### Frontend Blank Page
```bash
# Check browser console
# Verify API URL in .env.production
# Check .htaccess SPA routing rules
# Rebuild frontend if API URL changed
```

### Worker Not Running
```bash
# Check cron job syntax
# Verify node path is correct
# Check logs: tail -f logs/worker.log
# Test manually: node worker.js
```

---

## Post-Deployment Checklist

- [ ] API responds at `/api/health`
- [ ] Frontend loads without errors
- [ ] Database migrations completed
- [ ] Worker processing blocks (check logs)
- [ ] SSL certificate valid
- [ ] Wallet connection works
- [ ] Test campaign creation (testnet!)
- [ ] Test donations (testnet!)
- [ ] Monitor logs for 24 hours

---

## File Structure After Deployment

```
/home/username/
├── fundit-backend/
│   ├── .env (600 permissions)
│   ├── index.js
│   ├── worker.js
│   ├── logs/
│   └── ...
├── fundit-frontend/ (optional, if building on server)
│   └── dist/
└── public_html/
    ├── index.html
    ├── assets/
    └── .htaccess
```

---

## Support Resources

- **Full Guide:** `DEPLOYMENT_GUIDE.md`
- **Checklist:** `DEPLOYMENT_CHECKLIST.md`
- **cPanel Docs:** Your hosting provider's documentation
- **Cloudflare Docs:** https://developers.cloudflare.com

---

**Total Estimated Time: ~55 minutes**

Good luck! 🚀
