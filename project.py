import webview
import requests
import os

API_KEY = "b52e51777c8521c4c3365e3a2b1f0167"


class WeatherAPI:
    def fetch_weather_by_city(self, city):
        """Fetch weather by city name."""
        url = (
            f"http://api.openweathermap.org/data/2.5/weather"
            f"?q={city}&appid={API_KEY}&units=metric"
        )
        try:
            response = requests.get(url, timeout=10)
            return response.json()
        except requests.exceptions.RequestException:
            return {"error": "Network error. Please check your internet connection."}

    def fetch_weather_by_coords(self, lat, lon):
        """Fetch weather by lat/lon coordinates."""
        url = (
            f"http://api.openweathermap.org/data/2.5/weather"
            f"?lat={lat}&lon={lon}&appid={API_KEY}&units=metric"
        )
        try:
            response = requests.get(url, timeout=10)
            return response.json()
        except requests.exceptions.RequestException:
            return {"error": "Network error. Please check your internet connection."}


if __name__ == "__main__":
    api = WeatherAPI()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    html_file = os.path.join(base_dir, "web", "index.html")

    window = webview.create_window(
        title="Weather Globe",
        url=html_file,
        js_api=api,
        width=1400,
        height=900,
        resizable=True,
        min_size=(900, 600),
        background_color="#0a0e1a",
    )

    webview.start(debug=True)
