#!/bin/bash
# ============================================
# cPanel Setup Script for Fundit.fun
# ============================================
# Run this script via SSH after uploading files
# Make it executable: chmod +x cpanel-setup-script.sh

set -e  # Exit on error

echo "🚀 Fundit.fun cPanel Setup Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (UPDATE THESE!)
BACKEND_DIR="$HOME/fundit-backend"
FRONTEND_DIR="$HOME/fundit-frontend"
PUBLIC_HTML="$HOME/public_html"
NODE_VERSION="23"  # Adjust based on available versions

echo -e "${YELLOW}Configuration:${NC}"
echo "Backend Dir: $BACKEND_DIR"
echo "Frontend Dir: $FRONTEND_DIR"
echo "Public HTML: $PUBLIC_HTML"
echo ""

# Check if directories exist
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}Error: Backend directory not found: $BACKEND_DIR${NC}"
    exit 1
fi

# Step 1: Create logs directory
echo -e "${GREEN}Step 1: Creating logs directory...${NC}"
mkdir -p "$BACKEND_DIR/logs"
chmod 755 "$BACKEND_DIR/logs"
echo "✓ Logs directory created"

# Step 2: Check .env file
echo -e "${GREEN}Step 2: Checking .env file...${NC}"
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found!${NC}"
    echo "Please create .env file from env.template"
    echo "cp $BACKEND_DIR/env.template $BACKEND_DIR/.env"
    echo "Then edit .env with your values"
else
    echo "✓ .env file found"
    chmod 600 "$BACKEND_DIR/.env"
fi

# Step 3: Install backend dependencies
echo -e "${GREEN}Step 3: Installing backend dependencies...${NC}"
cd "$BACKEND_DIR"
if [ -f "package.json" ]; then
    npm install --production
    echo "✓ Backend dependencies installed"
else
    echo -e "${RED}Error: package.json not found${NC}"
    exit 1
fi

# Step 4: Check Node.js version
echo -e "${GREEN}Step 4: Checking Node.js version...${NC}"
NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 23 ]; then
    echo -e "${YELLOW}Warning: Node.js version $NODE_VER is less than 23${NC}"
    echo "Please ensure cPanel Node.js app uses version >= 23.8.0"
else
    echo "✓ Node.js version OK: $(node --version)"
fi

# Step 5: Test database connection (if psql available)
echo -e "${GREEN}Step 5: Testing database connection...${NC}"
if command -v psql &> /dev/null; then
    echo "Note: Test database connection manually:"
    echo "psql -U username_fundit_user -d username_fundit_db -h localhost"
else
    echo "psql not available, skipping database test"
fi

# Step 6: Frontend build (if building on server)
if [ -d "$FRONTEND_DIR" ]; then
    echo -e "${GREEN}Step 6: Building frontend...${NC}"
    cd "$FRONTEND_DIR"
    if [ -f "package.json" ]; then
        if [ ! -f ".env.production" ]; then
            echo -e "${YELLOW}Warning: .env.production not found!${NC}"
            echo "Create from template: cp env.production.template .env.production"
        fi
        npm install
        npm run build
        echo "✓ Frontend built"
        
        # Copy to public_html
        echo -e "${GREEN}Copying frontend build to public_html...${NC}"
        cp -r dist/* "$PUBLIC_HTML/"
        echo "✓ Frontend files copied"
    fi
fi

# Step 7: Set permissions
echo -e "${GREEN}Step 7: Setting file permissions...${NC}"
chmod 600 "$BACKEND_DIR/.env" 2>/dev/null || true
chmod 755 "$BACKEND_DIR" 2>/dev/null || true
chmod 755 "$BACKEND_DIR/logs" 2>/dev/null || true
echo "✓ Permissions set"

# Step 8: Create .htaccess if not exists
if [ ! -f "$PUBLIC_HTML/.htaccess" ]; then
    echo -e "${GREEN}Step 8: Creating .htaccess...${NC}"
    cat > "$PUBLIC_HTML/.htaccess" << 'EOF'
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
EOF
    echo "✓ .htaccess created"
fi

echo ""
echo -e "${GREEN}==================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}==================================${NC}"
echo ""
echo "Next steps:"
echo "1. Configure Node.js App in cPanel"
echo "2. Set up cron jobs for worker and monitor"
echo "3. Run database migrations: cd $BACKEND_DIR && npm run migrate"
echo "4. Test API: curl http://localhost:3000/api/health"
echo ""
echo "For detailed instructions, see DEPLOYMENT_GUIDE.md"
