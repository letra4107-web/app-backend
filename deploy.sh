#!/bin/bash

# LinawLetra Production Deployment Script
# This script helps deploy the backend to a free hosting service

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        LinawLetra Backend Deployment to Production             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if backend directory exists
if [ ! -d "backend" ]; then
    echo "❌ backend directory not found. Please run from project root."
    exit 1
fi

cd backend

echo "✓ Step 1: Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing npm packages..."
    npm install
fi

echo "✓ Step 2: Checking environment variables..."
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "Please edit .env with your Firebase and email credentials"
    exit 1
fi

echo "✓ Step 3: Backend ready for deployment"
echo ""
echo "Choose your deployment platform:"
echo "1) Firebase Functions + Hosting (Recommended if using Firebase)"
echo "2) Render.com (Free, easy to deploy)"
echo "3) Railway (Free, integrated with GitHub)"
echo "4) Fly.io (Free, fast deployment)"
echo "5) Heroku (Free tier ended, but you can try)"
echo ""
echo "For this guide, we'll use Firebase Hosting:"
echo ""
echo "📋 Firebase Deployment Steps:"
echo "1. Install Firebase CLI: npm install -g firebase-tools"
echo "2. Login: firebase login"
echo "3. Initialize: firebase init hosting"
echo "4. Deploy: firebase deploy"
echo ""
echo "After deployment, update your .env files with the Firebase URL."
echo ""
