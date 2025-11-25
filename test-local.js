// Local test script for booking endpoint
// Usage: node test-local.js

const testBooking = async () => {
  // TODO: Update these with your test credentials
  const testData = {
    email: "your-email@example.com",
    password: "your-password",
    gymName: "PontePila", // or your gym name
    targetDate: "2025-11-25", // Format: YYYY-MM-DD
    targetTime: "8:00 am", // Format: HH:mm or "8:00 am"
    debug: true // Set to true to see browser (if not in production mode)
  };

  console.log("🧪 Testing booking endpoint...");
  console.log("📋 Test data:", JSON.stringify(testData, null, 2));
  console.log("");

  try {
    const response = await fetch("http://localhost:3000/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testData),
    });

    const result = await response.json();
    
    console.log("📊 Response status:", response.status);
    console.log("📦 Response body:", JSON.stringify(result, null, 2));
    
    if (result.screenshots && result.screenshots.length > 0) {
      console.log("\n📸 Screenshots available:");
      result.screenshots.forEach((screenshot, index) => {
        console.log(`  ${index + 1}. http://localhost:3000/screenshots/${screenshot}`);
      });
    }
    
    if (result.clickCount !== undefined) {
      console.log(`\n🖱️  Total clicks: ${result.clickCount}`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
};

testBooking();

