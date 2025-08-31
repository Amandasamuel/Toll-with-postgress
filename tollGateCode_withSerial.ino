#include <WiFi.h>
#include <HTTPClient.h>

// Replace with your WiFi credentials
const char* ssid = "Tinibu4+";
const char* password = "thankGod";

// Backend URL
const char* serverUrl = "http://192.168.0.140:3000/debit"; // Node.js server

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi!");
  Serial.println("Enter Account ID (Card UID) to debit 100:");
}

void loop() {
  // Wait for input from Serial Monitor
  if (Serial.available()) {
    String cardUID = Serial.readStringUntil('\n');
    cardUID.trim(); // remove any whitespace/newline

    Serial.println("Debiting account: " + cardUID);

    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");

      String payload = "{\"card_uid\":\"" + cardUID + "\",\"amount\":100}";

      int httpResponseCode = http.POST(payload);

      if (httpResponseCode > 0) {
        String response = http.getString();
        Serial.println("Response: " + response);
      } else {
        Serial.println("Error on POST: " + String(httpResponseCode));
      }

      http.end();
    } else {
      Serial.println("WiFi not connected!");
    }

    Serial.println("\nEnter next Account ID:");
  }
}

