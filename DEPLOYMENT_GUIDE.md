# 🚀 Fundit.fun Production Deployment Guide for cPanel

This comprehensive guide will walk you through deploying Fundit.fun to production using cPanel hosting.

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Database Setup](#step-1-database-setup)
3. [Step 2: Backend Deployment](#step-2-backend-deployment)
4. [Step 3: Frontend Deployment](#step-3-frontend-deployment)
5. [Step 4: Environment Variables](#step-4-environment-variables)
6. [Step 5: SSL & Cloudflare Configuration](#step-5-ssl--cloudflare-configuration)
7. [Step 6: Process Management](#step-6-process-management)
8. [Step 7: Domain Configuration](#step-7-domain-configuration)
9. [Step 8: Testing & Verification](#step-8-testing--verification)
10. [Step 9: Monitoring & Maintenance](#step-9-monitoring--maintenance)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:
- ✅ Domain DNS pointing to Cloudflare
- ✅ cPanel access with Node.js and PostgreSQL support
- ✅ All contract addresses for deployed contracts
- ✅ RPC URLs for all blockchain networks
- ✅ Firebase Storage credentials
- ✅ Reown (WalletConnect) Project ID
- ✅ Master seed for wallet generation (keep secure!)

---

## Step 1: Database Setup

### 1.1 Create PostgreSQL Database

1. **Login to cPanel**
2. Navigate to **PostgreSQL Databases** (under Databases section)
3. **Create Database:**
   - Database name: `fundit_db` (or your preferred name)
   - Click **Create Database**
   - Note the full database name (usually `username_fundit_db`)

4. **Create Database User:**
   - Username: `fundit_user` (or your preferred name)
   - Password: Generate a strong password (save it!)
   - Click **Create User**

5. **Grant Privileges:**
   - Select the user and database
   - Click **Add User to Database**
   - Grant **ALL PRIVILEGES**
   - Click **Make Changes**

### 1.2 Get Database Connection String

After creation, your connection string format will be:
```
postgresql://username_fundit_user:password@localhost:5432/username_fundit_db
```

**Note:** cPanel PostgreSQL typically runs on port `5432` or a custom port. Check your cPanel PostgreSQL section for the exact port.

---

## Step 2: Backend Deployment

### 2.1 Upload Backend Code via Git

**Option A: Using Git in cPanel (Recommended)**

1. In cPanel, navigate to **Git Version Control**
2. Click **Create** or **Clone Repository**
3. Repository URL: Your Git repository URL (GitHub/GitLab/Bitbucket)
4. Repository Path: `/home/username/fundit-backend` (or your preferred path)
5. Click **Create** or **Clone**

**Option B: Manual Upload**

1. Compress your `backend` folder
2. Upload via **File Manager** or **FTP**
3. Extract in `/home/username/fundit-backend`

### 2.2 Install Node.js Dependencies

1. Navigate to **Node.js App** in cPanel
2. Click **Create Application**
3. Configure:
   - **Node.js Version:** Select latest (must be >= 23.8.0)
   - **Application Mode:** Production
   - **Application Root:** `/home/username/fundit-backend`
   - **Application URL:** Leave blank (we'll configure later)
   - **Application Startup File:** `index.js`
   - **Passenger Log File:** `/home/username/fundit-backend/logs/passenger.log`

4. Click **Create**

### 2.3 Install Dependencies via SSH

1. **Access SSH Terminal** (in cPanel or via SSH client)
2. Navigate to backend directory:
   ```bash
   cd ~/fundit-backend
   ```
3. Install dependencies:
   ```bash
   npm install --production
   ```

### 2.4 Create Required Directories

```bash
mkdir -p ~/fundit-backend/logs
mkdir -p ~/fundit-backend/scripts
chmod 755 ~/fundit-backend/logs
```

---

## Step 3: Frontend Deployment

### 3.1 Build Frontend Locally (Recommended)

**On your local machine:**

```bash
cd frontend
npm install
npm run build
```

This creates a `dist` folder with production-ready files.

### 3.2 Upload Frontend Build

1. **Compress the `dist` folder** from your local machine
2. **Upload to cPanel:**
   - Via **File Manager**: Upload to `/home/username/public_html/` (or your domain's document root)
   - Or via **FTP**

3. **Extract the files** in the document root

**Alternative: Build on Server**

If you prefer building on the server:

1. Upload entire `frontend` folder to `/home/username/fundit-frontend`
2. SSH into server:
   ```bash
   cd ~/fundit-frontend
   npm install
   npm run build
   ```
3. Copy `dist` contents to document root:
   ```bash
   cp -r ~/fundit-frontend/dist/* ~/public_html/
   ```

### 3.3 Configure Frontend Environment

Create `.env.production` file in frontend directory (before building) or configure build-time variables.

---

## Step 4: Environment Variables

### 4.1 Backend Environment Variables

Create `.env` file in `/home/username/fundit-backend/.env`:

```bash
# Server Configuration
NODE_ENV=production
PORT=3000

# Database Configuration
DATABASE_URL=postgresql://username_fundit_user:password@localhost:5432/username_fundit_db

# Blockchain RPC URLs (Main Chain - Polygon)
POLYGON_RPC=https://polygon-rpc-url-here
POLYGON_CONTRACT_ADDRESS=0xYourPolygonContractAddress

# Remote Chain RPC URLs
ETH_RPC=https://eth-rpc-url-here
ETH_CONTRACT_ADDRESS=0xYourEthContractAddress

BSC_RPC=https://bsc-rpc-url-here
BSC_CONTRACT_ADDRESS=0xYourBscContractAddress

BASE_RPC=https://base-rpc-url-here
BASE_CONTRACT_ADDRESS=0xYourBaseContractAddress

AVALANCHE_RPC=https://avalanche-rpc-url-here
AVALANCHE_CONTRACT_ADDRESS=0xYourAvalancheContractAddress

OPTIMISM_RPC=https://optimism-rpc-url-here
OPTIMISM_CONTRACT_ADDRESS=0xYourOptimismContractAddress

ARBITRUM_RPC=https://arbitrum-rpc-url-here
ARBITRUM_CONTRACT_ADDRESS=0xYourArbitrumContractAddress

SONIC_RPC=https://sonic-rpc-url-here
SONIC_CONTRACT_ADDRESS=0xYourSonicContractAddress

SONEIUM_RPC=https://soneium-rpc-url-here
SONEIUM_CONTRACT_ADDRESS=0xYourSoneiumContractAddress

# Wallet Generation (KEEP SECURE!)
WALLET_MASTER_SEED=your-master-seed-phrase-here-KEEP-SECRET

# CORS (Update with your domain)
CORS_ORIGIN=https://yourdomain.com
```

**Security Note:** 
- Never commit `.env` files to Git
- Use strong passwords
- Keep `WALLET_MASTER_SEED` extremely secure

### 4.2 Frontend Environment Variables

Create `.env.production` in frontend directory (before building):

```bash
VITE_APP_API_URL=https://api.yourdomain.com
# OR if API is on same domain:
VITE_APP_API_URL=https://yourdomain.com

VITE_PROJECT_ID=your-reown-project-id-here
```

**Important:** After building, these are baked into the JavaScript bundle. Rebuild if you change them.

### 4.3 Set File Permissions

```bash
chmod 600 ~/fundit-backend/.env
chmod 600 ~/fundit-frontend/.env.production
```

---

## Step 5: SSL & Cloudflare Configuration

### 5.1 Cloudflare SSL Settings

1. **Login to Cloudflare Dashboard**
2. Select your domain
3. Go to **SSL/TLS** → **Overview**
4. Set encryption mode to **Full (strict)**
5. Go to **SSL/TLS** → **Edge Certificates**
   - Enable **Always Use HTTPS**
   - Enable **Automatic HTTPS Rewrites**

### 5.2 cPanel SSL Configuration

1. In cPanel, go to **SSL/TLS Status**
2. Install SSL certificate (Let's Encrypt or Cloudflare Origin Certificate)
3. **For Cloudflare Origin Certificate:**
   - In Cloudflare: SSL/TLS → Origin Server → Create Certificate
   - Copy certificate and private key
   - In cPanel: SSL/TLS → Manage SSL Sites → Upload certificate

### 5.3 Force HTTPS Redirect

Create `.htaccess` in document root (`/home/username/public_html/.htaccess`):

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# API Proxy (if API is on same domain)
RewriteCond %{REQUEST_URI} ^/api/
RewriteRule ^api/(.*)$ http://localhost:3000/api/$1 [P,L]

# SPA Routing (for React Router)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

---

## Step 6: Process Management

### 6.1 Setup Node.js Application in cPanel

1. **In cPanel Node.js App:**
   - Find your application
   - **Application URL:** Set to subdomain or path (e.g., `api.yourdomain.com` or `/api`)
   - **Application Root:** `/home/username/fundit-backend`
   - **Application Startup File:** `index.js`
   - Click **Save**

2. **Start Application:**
   - Click **Run NPM Install** (if needed)
   - Click **Start App**

### 6.2 Setup Worker Process (Alternative: PM2)

**Option A: Using cPanel Cron Jobs (Recommended for Worker)**

1. Go to **Cron Jobs** in cPanel
2. Create new cron job:
   - **Common Settings:** Every 5 minutes
   - **Command:**
     ```bash
     cd /home/username/fundit-backend && /home/username/nodevenv/fundit-backend/23/bin/node worker.js >> /home/username/fundit-backend/logs/worker.log 2>&1
     ```
   - Adjust Node.js path based on your cPanel Node.js installation

**Option B: Using PM2 (If Available)**

1. Install PM2 globally:
   ```bash
   npm install -g pm2
   ```

2. Create PM2 ecosystem file (`ecosystem.config.js`):
   ```javascript
   module.exports = {
     apps: [
       {
         name: 'fundit-api',
         script: './index.js',
         instances: 1,
         exec_mode: 'fork',
         env: {
           NODE_ENV: 'production'
         }
       },
       {
         name: 'fundit-worker',
         script: './worker.js',
         instances: 1,
         exec_mode: 'fork',
         env: {
           NODE_ENV: 'production'
         }
       },
       {
         name: 'fundit-monitor',
         script: './scripts/monitor-donations.js',
         instances: 1,
         exec_mode: 'fork',
         env: {
           NODE_ENV: 'production'
         }
       }
     ]
   };
   ```

3. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup  # Follow instructions to enable on reboot
   ```

### 6.3 Setup Direct Donation Monitor

Create another cron job for donation monitoring:

```bash
cd /home/username/fundit-backend && /home/username/nodevenv/fundit-backend/23/bin/node scripts/monitor-donations.js >> /home/username/fundit-backend/logs/monitor.log 2>&1
```

Run every 1-2 minutes.

---

## Step 7: Domain Configuration

### 7.1 DNS Records in Cloudflare

Ensure these records exist:

```
Type    Name    Content              Proxy Status
A       @       your-server-ip        Proxied
A       api     your-server-ip        Proxied (or DNS only)
CNAME   www     yourdomain.com        Proxied
```

### 7.2 cPanel Domain Setup

1. **Addon Domain or Subdomain:**
   - If using subdomain for API: Create subdomain `api.yourdomain.com`
   - Point to `/home/username/fundit-backend` (for Node.js app)

2. **Main Domain:**
   - Point to `/home/username/public_html` (frontend)

### 7.3 Update Frontend API URL

If API is on subdomain, update frontend `.env.production`:

```bash
VITE_APP_API_URL=https://api.yourdomain.com
```

Rebuild frontend after changes.

---

## Step 8: Testing & Verification

### 8.1 Database Migration

SSH into server and run migrations:

```bash
cd ~/fundit-backend
node migrations/runner.js
```

Or via Node.js app:
```bash
npm run migrate
```

### 8.2 Test Backend API

```bash
# Test indexer status
curl https://api.yourdomain.com/api/indexer-status

# Test campaigns endpoint
curl https://api.yourdomain.com/api/campaigns?limit=5
```

### 8.3 Test Frontend

1. Visit `https://yourdomain.com`
2. Check browser console for errors
3. Test wallet connection
4. Test campaign creation (on testnet first!)

### 8.4 Verify Worker is Running

Check logs:
```bash
tail -f ~/fundit-backend/logs/combined.log
tail -f ~/fundit-backend/logs/worker.log
```

---

## Step 9: Monitoring & Maintenance

### 9.1 Log Management

**Backend Logs:**
- `~/fundit-backend/logs/combined.log` - All logs
- `~/fundit-backend/logs/error.log` - Errors only
- `~/fundit-backend/logs/worker.log` - Worker output
- `~/fundit-backend/logs/monitor.log` - Donation monitor output

**Set up log rotation:**

Create `/home/username/fundit-backend/logrotate.conf`:
```
/home/username/fundit-backend/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

### 9.2 Health Check Endpoint

Add to backend API (`src/api/index.js`):

```javascript
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### 9.3 Regular Maintenance Tasks

**Daily:**
- Check error logs
- Verify worker is processing blocks
- Monitor donation monitor logs

**Weekly:**
- Run reconciliation: `npm run reconcile`
- Check database size
- Review API usage

**Monthly:**
- Update dependencies (test first!)
- Review and rotate logs
- Backup database

### 9.4 Database Backups

Set up automated backups in cPanel:

1. Go to **Backup** → **Backup Configuration**
2. Enable **Database Backups**
3. Schedule regular backups
4. Download backups regularly

Or via cron:
```bash
0 2 * * * pg_dump -U username_fundit_user username_fundit_db > /home/username/backups/fundit_$(date +\%Y\%m\%d).sql
```

---

## Troubleshooting

### Issue: Node.js version mismatch

**Solution:**
- Check Node.js version in cPanel: `node --version`
- Must be >= 23.8.0
- If not available, request hosting provider to update

### Issue: Database connection failed

**Check:**
1. Database credentials in `.env`
2. Database user has proper permissions
3. PostgreSQL is running
4. Port number is correct

**Test connection:**
```bash
psql -U username_fundit_user -d username_fundit_db -h localhost
```

### Issue: API not accessible

**Check:**
1. Node.js app is started in cPanel
2. Port is correct (usually 3000)
3. Firewall allows port
4. `.htaccess` proxy rules (if using same domain)

### Issue: Frontend shows blank page

**Check:**
1. Browser console for errors
2. API URL is correct
3. SSL certificate is valid
4. `.htaccess` SPA routing rules

### Issue: Worker not processing blocks

**Check:**
1. Worker cron job is running
2. RPC URLs are accessible
3. Contract addresses are correct
4. Check worker logs for errors

### Issue: CORS errors

**Solution:**
- Update `CORS_ORIGIN` in backend `.env`
- Ensure frontend domain matches
- Check Cloudflare proxy settings

### Issue: Out of memory

**Solution:**
- Reduce batch sizes in `worker.js`
- Increase Node.js memory limit in cPanel
- Or contact hosting provider

---

## Security Checklist

- [ ] `.env` files have correct permissions (600)
- [ ] Database passwords are strong
- [ ] `WALLET_MASTER_SEED` is secure and backed up
- [ ] SSL certificates are installed
- [ ] HTTPS is enforced
- [ ] API has rate limiting enabled
- [ ] Firewall rules are configured
- [ ] Regular backups are scheduled
- [ ] Logs don't contain sensitive data
- [ ] Dependencies are up to date

---

## Quick Reference Commands

```bash
# Navigate to backend
cd ~/fundit-backend

# Check Node.js version
node --version

# Run migrations
npm run migrate

# Start API (if not using cPanel Node.js app)
npm start

# Run worker manually
node worker.js

# Check logs
tail -f logs/combined.log
tail -f logs/error.log

# Test database connection
psql -U username_fundit_user -d username_fundit_db

# Rebuild frontend
cd ~/fundit-frontend
npm run build
cp -r dist/* ~/public_html/
```

---

## Support & Resources

- **cPanel Documentation:** https://docs.cpanel.net
- **Node.js cPanel Guide:** Check your hosting provider's docs
- **PostgreSQL cPanel:** Check your hosting provider's docs
- **Cloudflare Docs:** https://developers.cloudflare.com

---

## Next Steps After Deployment

1. ✅ Test all functionality on mainnet
2. ✅ Monitor for 24-48 hours
3. ✅ Set up uptime monitoring (UptimeRobot, etc.)
4. ✅ Configure error alerting
5. ✅ Create runbook for common issues
6. ✅ Document any custom configurations

---

**Good luck with your deployment! 🚀**

If you encounter issues not covered here, check logs first, then consult your hosting provider's support.
