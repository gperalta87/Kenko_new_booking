# Booking Railway API

Puppeteer-based booking scraper API for fitness class bookings. Deployed on Railway.

## Features

- Automated class booking via Puppeteer
- RESTful API endpoint for booking requests
- Docker containerization for Railway deployment
- Support for dynamic gym selection and date/time booking

## API Endpoint

### POST `/book`

Book a fitness class.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password",
  "gymName": "PontePila",
  "targetDate": "2025-11-05",
  "targetTime": "8:00 am",
  "debug": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking completed successfully",
  "bookingId": "12345"
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `HEADLESS`: Run browser in headless mode (default: true)

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Run the server:
```bash
npm start
```

3. For development with auto-reload:
```bash
npm run dev
```

## Railway Deployment

This project is configured for Railway deployment with:
- `railway.json`: Railway configuration
- `Dockerfile`: Container configuration for Puppeteer

The app will automatically build and deploy when pushed to the connected repository.

## License

ISC

