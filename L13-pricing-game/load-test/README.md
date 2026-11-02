# Load Testing for Pricing Game

Test your production deployment before using it in the classroom!

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd load-test
npm install
```

### 2. Run Production Test (Recommended)

This interactive script will guide you through testing your deployed Render app:

```bash
npm run test:production
```

It will:
- Ask for your Render URL
- Check if server is online
- Let you choose which tests to run
- Give you a summary at the end

### 3. Or Run Individual Tests

Test your production server with specific numbers of students:

```bash
# Test with 10 students (quick smoke test)
SERVER_URL=https://your-render-app.onrender.com npm run test:small

# Test with 50 students (medium class)
SERVER_URL=https://your-render-app.onrender.com npm run test:medium

# Test with 100 students (large class)
SERVER_URL=https://your-render-app.onrender.com npm run test:large

# Test with 200 students (stress test)
SERVER_URL=https://your-render-app.onrender.com npm run test:xlarge
```

### 4. Test Localhost (Development)

```bash
# Make sure your server is running locally first
cd ../server
node server.js

# Then in another terminal
cd ../load-test
npm run test:small
```

---

## 📊 Understanding Results

### ✅ Excellent Performance
```
📊 Final Results:
   Connected: 50/50
   Joined: 50/50
   Prices Submitted: 150/150
   Errors: 0

🎯 Assessment:
   ✅ EXCELLENT - Server handled the load well!
```

**What this means:** Your server can handle this many students easily!

---

### ⚠️ Acceptable Performance
```
📊 Final Results:
   Connected: 48/50
   Joined: 47/50
   Prices Submitted: 135/150
   Errors: 5

🎯 Assessment:
   ⚠️  ACCEPTABLE - Some issues, but mostly functional
```

**What this means:** Works but has some hiccups. Consider:
- Running smaller sessions (split students into groups)
- Checking error messages for patterns

---

### ❌ Poor Performance
```
📊 Final Results:
   Connected: 35/50
   Joined: 32/50
   Prices Submitted: 78/150
   Errors: 18

🎯 Assessment:
   ❌ POOR - Server struggled with this load
   💡 Consider: Reducing students per session or upgrading server
```

**What this means:** Server can't handle this load. You need to:
1. Upgrade your Render plan (from Free to Starter or Standard)
2. Run multiple smaller sessions instead of one large one
3. Reduce the number of students per session

---

## 🎯 Recommended Testing Strategy

### Before Your First Classroom Use:

**Week Before Class:**
1. Test on production with 10 students
2. Test on production with your expected class size
3. Test on production with 2× your expected class size (stress test)

**Day Before Class:**
1. Quick 10-student smoke test on production
2. Verify all features work (create session, join, play, download CSV)

**Morning of Class:**
1. 5-minute smoke test (2-3 students)
2. Keep Render dashboard open during class

---

## 🔧 Troubleshooting

### "Connection timeout" errors

**Problem:** Server can't handle connections
**Solutions:**
- Upgrade Render plan
- Reduce number of students
- Check server logs on Render dashboard

### "Session not found" errors

**Problem:** Session expired or wasn't created
**Solutions:**
- Make sure server is running
- Check that you're using the correct session code
- Try creating a new session

### High submission failures

**Problem:** Students can't submit prices in time
**Solutions:**
- Increase round time (server config)
- Check if server is overloaded (CPU/memory on Render)
- Reduce number of students per session

### Server crashes during test

**Problem:** Out of memory or resources
**Solutions:**
- **Definitely** upgrade from Free tier
- Consider Standard plan for 50+ students
- Split into multiple smaller sessions

---

## 📈 Capacity Guidelines

Based on Render plans:

### Free Tier (Current)
- **Max Students:** 10-20
- **Issues:** Server sleeps after 15 min, limited resources
- **Use For:** Development and testing only

### Starter Plan ($7/month)
- **Max Students:** 30-50
- **Performance:** Good for small/medium classes
- **Use For:** Regular classroom use

### Standard Plan ($25/month)
- **Max Students:** 75-100
- **Performance:** Great for large classes
- **Use For:** Large lectures, multiple concurrent sessions

### Pro Plan ($85/month)
- **Max Students:** 150-200
- **Performance:** Excellent
- **Use For:** Very large classes or multiple simultaneous sessions

---

## 🎓 Example: Testing for a 300-Student Class

### Strategy 1: Multiple Sessions (Recommended)
```bash
# Test 6 sessions of 50 students each
# This is more reliable and cheaper

SERVER_URL=https://your-app.onrender.com npm run test:medium
```
- **Cost:** Standard plan ($25/month)
- **Reliability:** High
- **Student Experience:** Excellent

### Strategy 2: One Large Session (Not Recommended)
```bash
# Test one session with 300 students
# This requires expensive infrastructure

NUM_STUDENTS=300 SERVER_URL=https://your-app.onrender.com npm test
```
- **Cost:** Pro Plus plan ($185/month) + PostgreSQL
- **Reliability:** Medium
- **Student Experience:** May be slow

---

## 📝 What Gets Tested

The load test simulates real student behavior:

✅ **Connection:** Can students connect via WebSocket?
✅ **Join Session:** Can students join with session code?
✅ **Submit Prices:** Can students submit prices during rounds?
✅ **Receive Results:** Do students get results after each round?
✅ **Multiple Rounds:** Does the game handle 3 rounds?
✅ **Concurrency:** Can everyone submit at the same time?
✅ **Performance:** How long do operations take?

---

## 💡 Tips

1. **Start Small:** Always test with 10 students first
2. **Test Production:** Don't just test localhost - test your actual Render deployment
3. **Check Logs:** Watch Render logs during testing for errors
4. **Upgrade Early:** If tests show issues, upgrade before class day
5. **Have Backup:** Always have a backup plan if tech fails
6. **Monitor:** Keep Render dashboard open during actual classroom use

---

## 🆘 Need Help?

If tests are failing:

1. Check Render logs for specific errors
2. Verify your server is on Starter plan or higher (not Free)
3. Try reducing the number of students
4. Consider running multiple smaller sessions instead of one large one
5. Check that CORS is configured correctly for your domain

---

## 📞 Support

For issues with the load testing scripts, check:
- Server logs on Render dashboard
- Browser console for JavaScript errors
- Network tab in browser dev tools for failed requests

Good luck with your classroom session! 🎓

