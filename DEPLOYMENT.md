# Railway Deployment Guide

This guide ensures the exact same booking process runs on Railway as it does locally.

## Pre-Deployment Checklist

### ✅ Code Changes
- [x] Click tracking and logging implemented
- [x] Gym selection optimized (only working strategy)
- [x] Double-booking prevention (single click guard)
- [x] Screenshots for debugging
- [x] All logging writes to `/tmp/booking-server.log`

### ✅ Configuration Files
- [x] `Dockerfile` - Configured for Railway with Puppeteer
- [x] `railway.json` - Railway deployment config
- [x] `package.json` - Dependencies defined
- [x] `server.js` - Uses `process.env.PORT` (Railway sets this automatically)

## Deployment Steps

### 1. Commit All Changes
```bash
git add .
git commit -m "Add click tracking, optimize gym selection, fix double-booking"
git push origin main
```

### 2. Railway Will Automatically:
- Detect the push to main branch
- Build the Docker image using `Dockerfile`
- Install dependencies (`npm install --only=production`)
- Copy all source files
- Start the server with `node server.js`

### 3. Verify Deployment

#### Check Railway Dashboard:
1. Go to your Railway project
2. Check the "Deployments" tab - should show latest build
3. Check "Logs" tab - should see:
   ```
   🚀 Starting server initialization...
   ✅ Express imported
   ✅ Puppeteer imported
   ✅ Server is listening on 0.0.0.0:PORT
   ```

#### Test Health Endpoint:
```bash
curl https://your-railway-app.railway.app/
# Should return: ✅ Booking scraper API online
```

#### Test Booking Endpoint:
```bash
curl -X POST https://your-railway-app.railway.app/book \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password",
    "gymName": "PontePila",
    "targetDate": "2025-11-25",
    "targetTime": "9:00 am",
    "debug": true
  }'
```

## Railway-Specific Configuration

### Environment Variables (Optional)
Railway automatically sets:
- `PORT` - Server port (don't override)
- `NODE_ENV=production` - Set by Dockerfile

### Logs Location
- **Console logs**: Available in Railway dashboard "Logs" tab
- **File logs**: Written to `/tmp/booking-server.log` (accessible via Railway shell if needed)

### Health Check
- **Endpoint**: `/` (configured in `railway.json`)
- **Timeout**: 300 seconds (for long-running bookings)
- **Restart Policy**: ON_FAILURE with max 10 retries

## Differences: Local vs Railway

| Aspect | Local | Railway |
|--------|-------|---------|
| Port | 3000 (default) | Set by Railway automatically |
| Browser | Headless (can be disabled) | Always headless |
| Logs | Console + `/tmp/booking-server.log` | Console + `/tmp/booking-server.log` |
| Environment | Development | Production (`NODE_ENV=production`) |
| X11/D-Bus | May exist | Automatically cleaned up by code |

## Troubleshooting

### If booking fails on Railway:

1. **Check Railway Logs**:
   - Go to Railway dashboard → Logs tab
   - Look for `[CLICK #X]`, `[GYM SELECTION]`, `[BOOK BUTTON]` entries
   - Check for error messages

2. **Verify Environment Variables**:
   - Railway dashboard → Variables tab
   - Ensure no conflicting variables are set

3. **Check Health Endpoint**:
   ```bash
   curl https://your-app.railway.app/
   ```

4. **Review Click Logs**:
   - Look for `[CLICK SUMMARY]` in logs
   - Check if double-clicks are detected
   - Verify gym selection method used

### Common Issues:

**Issue**: "Could not find gym input element"
- **Solution**: Check if gym name is typed correctly, wait longer for suggestions

**Issue**: "Double-booking detected"
- **Solution**: Check click logs - should only see 1 click on BOOK USING CREDITS button

**Issue**: "Gym selection failed"
- **Solution**: Check logs for which strategy was used, verify coordinates

## Monitoring

### Key Log Patterns to Watch:

1. **Gym Selection Success**:
   ```
   [GYM SELECTION SUMMARY] Success: true, Method: Puppeteer mouse click at coordinates
   ```

2. **Single Booking**:
   ```
   [BOOK BUTTON] Completed. Clicks made in this step: 1
   ```

3. **Double-Booking Warning**:
   ```
   [WARNING] Multiple clicks detected on BOOK USING CREDITS button!
   ```

## Rollback Plan

If deployment has issues:

1. **Revert to previous commit**:
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Or redeploy previous version**:
   - Railway dashboard → Deployments
   - Find previous successful deployment
   - Click "Redeploy"

## Next Steps After Deployment

1. ✅ Test booking endpoint with real credentials
2. ✅ Monitor logs for first few bookings
3. ✅ Verify no double-bookings occur
4. ✅ Check gym selection is working correctly
5. ✅ Confirm all click tracking is logged properly

