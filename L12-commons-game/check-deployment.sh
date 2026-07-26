#!/bin/bash

echo "🔍 Checking Commons Game Deployment Status..."
echo ""

echo "1️⃣ Checking Render Backend:"
echo "   URL: https://commons-game-server.onrender.com/health"
BACKEND_RESPONSE=$(curl -s -w "\n%{http_code}" https://commons-game-server.onrender.com/health)
BACKEND_STATUS=$(echo "$BACKEND_RESPONSE" | tail -n1)
BACKEND_BODY=$(echo "$BACKEND_RESPONSE" | head -n1)

if [ "$BACKEND_STATUS" = "200" ]; then
  echo "   ✅ Backend is UP and running"
  echo "   Response: $BACKEND_BODY"
else
  echo "   ❌ Backend is DOWN or not responding properly"
  echo "   HTTP Status: $BACKEND_STATUS"
fi

echo ""
echo "2️⃣ Checking Frontend Deployment:"
echo "   URL: https://commons-game.vercel.app"
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://commons-game.vercel.app)

if [ "$FRONTEND_STATUS" = "200" ]; then
  echo "   ✅ Frontend is UP and serving"
else
  echo "   ❌ Frontend is not responding properly"
  echo "   HTTP Status: $FRONTEND_STATUS"
fi

echo ""
echo "3️⃣ Testing Session Creation (simulating frontend):"
SESSION_RESPONSE=$(curl -s -X POST https://commons-game-server.onrender.com/session \
  -H "Content-Type: application/json" \
  -H "Origin: https://commons-game.vercel.app" \
  -d '{"instructorName":"TestInstructor","config":{"rounds":5,"roundTime":15,"playersPerPond":4}}' \
  -w "\n%{http_code}")

SESSION_STATUS=$(echo "$SESSION_RESPONSE" | tail -n1)
SESSION_BODY=$(echo "$SESSION_RESPONSE" | head -n1)

if [ "$SESSION_STATUS" = "201" ]; then
  echo "   ✅ Session creation works"
  echo "   Response: $SESSION_BODY"
else
  echo "   ❌ Session creation failed"
  echo "   HTTP Status: $SESSION_STATUS"
  echo "   Response: $SESSION_BODY"
fi

echo ""
echo "📋 Summary:"
echo "   Backend:  $([ "$BACKEND_STATUS" = "200" ] && echo "✅ OK" || echo "❌ FAIL")"
echo "   Frontend: $([ "$FRONTEND_STATUS" = "200" ] && echo "✅ OK" || echo "❌ FAIL")"
echo "   API:      $([ "$SESSION_STATUS" = "201" ] && echo "✅ OK" || echo "❌ FAIL")"
echo ""

if [ "$BACKEND_STATUS" = "200" ] && [ "$FRONTEND_STATUS" = "200" ] && [ "$SESSION_STATUS" = "201" ]; then
  echo "🎉 All systems operational!"
  echo ""
  echo "⚠️  IMPORTANT: If automation still fails, make sure you:"
  echo "   1. Added VITE_SOCKET_URL=https://commons-game-server.onrender.com to Vercel"
  echo "   2. REDEPLOYED Vercel after adding the environment variable"
  echo "   3. Try: npm run automate -- -o"
else
  echo "❌ Some systems are not working properly"
fi

