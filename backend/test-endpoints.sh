#!/bin/bash

# Quick test script for backend endpoints

BASE_URL="${1:-https://app-backend-production-f32c.up.railway.app}"
echo "Testing backend at: $BASE_URL"
echo ""

# Test health endpoint
echo "1. Testing /health endpoint..."
curl -s "$BASE_URL/health" | jq . || echo "❌ Health check failed"
echo ""

# Test auth endpoints
echo "2. Testing /api/auth endpoints..."
curl -s -X POST "$BASE_URL/api/auth/send-email-otp" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq . || echo "❌ Send OTP failed"
echo ""

# Add more test cases as needed
echo "Testing complete!"
