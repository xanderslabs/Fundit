# ✅ Fundit.fun Deployment Checklist

Use this checklist to ensure all steps are completed during deployment.

## Pre-Deployment

- [ ] All smart contracts deployed and verified
- [ ] Contract addresses documented
- [ ] RPC URLs for all networks ready
- [ ] Firebase Storage credentials ready
- [ ] Reown Project ID obtained
- [ ] Master seed phrase generated and securely stored
- [ ] Domain DNS configured in Cloudflare
- [ ] cPanel access credentials ready

## Database Setup

- [ ] PostgreSQL database created in cPanel
- [ ] Database user created
- [ ] User granted ALL privileges on database
- [ ] Database connection string documented
- [ ] Database backup strategy planned

## Backend Deployment

- [ ] Backend code uploaded (via Git or FTP)
- [ ] Node.js application created in cPanel
- [ ] Node.js version >= 23.8.0 confirmed
- [ ] Dependencies installed (`npm install --production`)
- [ ] `.env` file created with all variables
- [ ] `.env` file permissions set to 600
- [ ] Logs directory created (`logs/`)
- [ ] Database migrations run successfully
- [ ] API starts without errors
- [ ] Health endpoint responds (`/api/health`)

## Frontend Deployment

- [ ] Frontend built locally (`npm run build`)
- [ ] `.env.production` configured
- [ ] Build files uploaded to document root
- [ ] `.htaccess` file uploaded
- [ ] Frontend loads without errors
- [ ] API connection works from frontend
- [ ] Wallet connection works

## SSL & Security

- [ ] SSL certificate installed (Let's Encrypt or Cloudflare Origin)
- [ ] HTTPS redirect configured
- [ ] Cloudflare SSL mode set to "Full (strict)"
- [ ] Security headers configured in `.htaccess`
- [ ] CORS configured correctly
- [ ] Rate limiting enabled

## Process Management

- [ ] Node.js API app started in cPanel
- [ ] Worker process configured (cron or PM2)
- [ ] Direct donation monitor configured (cron or PM2)
- [ ] All processes running without errors
- [ ] Auto-restart configured for processes

## Domain Configuration

- [ ] Main domain points to frontend
- [ ] API subdomain configured (if using)
- [ ] DNS records correct in Cloudflare
- [ ] Domain resolves correctly
- [ ] SSL works on all domains/subdomains

## Testing

- [ ] Frontend loads at `https://yourdomain.com`
- [ ] API responds at configured URL
- [ ] Database connection works
- [ ] Indexer status endpoint works
- [ ] Campaigns endpoint returns data
- [ ] Wallet connection works
- [ ] Campaign creation works (testnet first!)
- [ ] Donations work (testnet first!)
- [ ] Cross-chain donations work (testnet first!)
- [ ] Worker processes blocks correctly
- [ ] Logs are being written

## Monitoring & Maintenance

- [ ] Log rotation configured
- [ ] Error logs monitored
- [ ] Database backup scheduled
- [ ] Health check endpoint working
- [ ] Uptime monitoring set up (optional)
- [ ] Error alerting configured (optional)

## Post-Deployment

- [ ] All functionality tested on mainnet
- [ ] Team notified of deployment
- [ ] Documentation updated
- [ ] Monitoring active for 24-48 hours
- [ ] Performance metrics baseline established

## Security Review

- [ ] `.env` files not in Git
- [ ] Database passwords are strong
- [ ] Master seed is secure
- [ ] File permissions correct
- [ ] No sensitive data in logs
- [ ] Dependencies up to date
- [ ] Firewall rules configured

## Rollback Plan

- [ ] Previous version backed up
- [ ] Database backup available
- [ ] Rollback procedure documented
- [ ] Team knows rollback process

---

## Quick Test Commands

```bash
# Test API
curl https://api.yourdomain.com/api/health
curl https://api.yourdomain.com/api/campaigns?limit=5

# Test database
psql -U username_fundit_user -d username_fundit_db -h localhost

# Check logs
tail -f ~/fundit-backend/logs/combined.log
tail -f ~/fundit-backend/logs/error.log

# Check processes
ps aux | grep node
```

---

**Deployment Date:** _______________
**Deployed By:** _______________
**Version:** _______________
