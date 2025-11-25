// Railway test script for booking endpoint
// Usage: node test-railway.js

const testBooking = async () => {
  const baseUrl = "https://kenkonewbooking-production.up.railway.app";
  
  const testData = {
    email: "ocapur@gmail.com",
    password: "Rusia2018",
    gymName: "PontePila",
    targetDate: "2025-11-27", // Format: YYYY-MM-DD
    targetTime: "9:00 am", // Format: HH:mm or "9:00 am"
    debug: false // Railway runs in headless mode
  };

  console.log("🚂 Testing Railway booking endpoint...");
  console.log("🌐 Target URL:", baseUrl);
  console.log("📋 Test data:", JSON.stringify(testData, null, 2));
  console.log("");

  try {
    const response = await fetch(`${baseUrl}/book`, {
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
        console.log(`  ${index + 1}. ${baseUrl}/screenshots/${screenshot}`);
      });
    }
    
    if (result.clickCount !== undefined) {
      console.log(`\n🖱️  Total clicks: ${result.clickCount}`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.cause) {
      console.error("   Cause:", error.cause);
    }
  }
};

testBooking();

