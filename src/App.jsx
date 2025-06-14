import { useState, useEffect } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import "./App.css";

const SKELETON_ROW_COUNT = 8; // Number of shimmer rows to show when loading

const App = () => {
  const [ticker, setTicker] = useState("AAPL");
  const [stockInfo, setStockInfo] = useState(null);
  const [error, setError] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [selectedStrike, setSelectedStrike] = useState("");
  const [customPremiums, setCustomPremiums] = useState({});
  const [loading, setLoading] = useState(false);

  // Main GET fetch
  const fetchStrategyData = async (symbol, expiry = "", strike = "") => {
    setLoading(true);
    try {
      const url =
        `http://localhost:8000/options-strategy-pnl?ticker=${symbol}` +
        (expiry ? `&expiry=${expiry}` : "") +
        (strike ? `&strike=${strike}` : "");

      const res = await axios.get(url);
      const data = res.data;
      setStockInfo(data);
      setCustomPremiums({});
      if (!selectedExpiry) setSelectedExpiry(data.expiry || expiry);
      if (!selectedStrike)
        setSelectedStrike(data.selected_strike || data.atm_strike || strike);
      setError(null);
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      setStockInfo(null);
      setError("Failed to fetch strategy data. Please check the ticker.");
    }
    setLoading(false);
  };

  // Premium POST (custom override) - UPDATED LOGIC
  const fetchCustomStrategyData = async (
    symbol,
    expiry,
    strike,
    updatedPremiums
  ) => {
    setLoading(true);
    try {
      // Updated: build the payload to match backend expectation
      // { [selectedStrategy]: { buy_premium: ..., sell_premium: ..., ... } }
      const premiums = {};
      strategyLegs.forEach((leg) => {
        premiums[leg.premiumKey] = Number(updatedPremiums[leg.key]);
      });
      const payload = {
        [selectedStrategy]: premiums,
      };

      const url =
        `http://localhost:8000/options-strategy-pnl-custom?ticker=${symbol}` +
        (expiry ? `&expiry=${expiry}` : "") +
        (strike ? `&strike=${strike}` : "");

      const res = await axios.post(url, payload);
      setStockInfo(res.data);
      setError(null);
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      setError("Failed to update with custom premiums.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStrategyData(ticker);
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (stockInfo) {
      fetchStrategyData(ticker, selectedExpiry, selectedStrike);
    }
    // eslint-disable-next-line
  }, [selectedExpiry, selectedStrike]);

  useEffect(() => {
    if (
      stockInfo &&
      stockInfo.strategies &&
      stockInfo.strategies.length > 0 &&
      !selectedStrategy
    ) {
      const keys = Object.keys(stockInfo.strategies[0]).filter(
        (k) => k !== "Price at Expiry" && k !== "premium_breakdown"
      );
      setSelectedStrategy(keys[0]);
    }
    // eslint-disable-next-line
  }, [stockInfo, selectedStrategy]);

  useEffect(() => {
    if (Object.keys(customPremiums).length > 0) {
      fetchCustomStrategyData(
        ticker,
        selectedExpiry,
        selectedStrike,
        customPremiums
      );
    }
    // eslint-disable-next-line
  }, [customPremiums, ticker, selectedExpiry, selectedStrike]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSelectedExpiry("");
    setSelectedStrategy("");
    setSelectedStrike("");
    fetchStrategyData(ticker);
  };

  const prettyLabel = (key) => {
    return key
      .replace(/_/g, " ")
      .replace("strike", "Strike")
      .replace("premium", "Premium")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  // === UPDATED LEG EXTRACTION LOGIC TO INCLUDE premiumKey ===
  const extractLegs = (strategyPremiums) => {
    const legs = [];
    if (!strategyPremiums || typeof strategyPremiums !== "object") return legs;

    // Map all premium keys by their corresponding strike keys
    Object.entries(strategyPremiums).forEach(([k, v]) => {
      if (k.toLowerCase().includes("strike")) {
        // Find corresponding premium key for this strike key
        let premiumKey;
        if (k.includes("buy")) premiumKey = k.replace("strike", "premium");
        else if (k.includes("sell"))
          premiumKey = k.replace("strike", "premium");
        else if (k === "call_strike") premiumKey = "call_premium";
        else if (k === "put_strike") premiumKey = "put_premium";
        else premiumKey = "premium";

        legs.push({
          key: `${k}_${v}`,
          strike: v,
          premium: strategyPremiums[premiumKey],
          strikeLabel: prettyLabel(k),
          premiumKey, // <-- important for POST payload
        });
      }
    });
    return legs;
  };

  // Use selectedStrategy to get premium breakdown for current strategy
  const premiumData =
    stockInfo?.strategies?.[0]?.premium_breakdown?.[selectedStrategy] || {};

  const strategyLegs = extractLegs(premiumData);

  // Premium Change Handler triggers POST ONLY on Enter
  const handlePremiumKeyDown = (e, key) => {
    if (e.key === "Enter") {
      const value = e.target.value;
      setCustomPremiums((prev) => ({ ...prev, [key]: Number(value) }));
    }
  };

  const handlePremiumInput = (key, value) => {
    // Controlled input: update local state only, don't POST yet
    setCustomPremiums((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="app-container">
      {stockInfo && (
        <div className="stock-info">
          <div className="stock-info-header">
            <div className="left-section">
              <h2 className="stock-info-title">
                {stockInfo.ticker} — Current Price: ${stockInfo.current_price}
              </h2>
            </div>

            <form onSubmit={handleSearch} className="search-form">
              <div className="search-input-container">
                <Search className="search-icon-svg" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Enter ticker..."
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                />
              </div>
            </form>
          </div>
          <div className="selectors-row">
            <label> Expiry: </label>
            <select
              className="dropdown"
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
            >
              {stockInfo.available_expiries?.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
            <label> Strategy: </label>
            <select
              className="dropdown"
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
            >
              {stockInfo?.strategies?.[0] &&
                Object.keys(stockInfo.strategies[0])
                  .filter(
                    (key) =>
                      key !== "Price at Expiry" && key !== "premium_breakdown"
                  )
                  .map((strategy) => (
                    <option key={strategy} value={strategy}>
                      {strategy
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                    </option>
                  ))}
            </select>
            <label> Strike: </label>
            <select
              className="dropdown"
              value={selectedStrike}
              onChange={(e) => setSelectedStrike(Number(e.target.value))}
            >
              {stockInfo.available_strikes?.map((strike) => (
                <option key={strike} value={strike}>
                  {strike}
                </option>
              ))}
            </select>
          </div>

          {/* Premium Inputs for all legs */}
          {strategyLegs.length > 0 && (
            <div className="multi-leg-strikes">
              {strategyLegs.map((leg, index) => (
                <div key={index} className="strike-premium-row">
                  <label>
                    {leg.strikeLabel}: {leg.strike}
                  </label>
                  <div className="selectors-row-premium">
                    <label>Premium: </label>
                    <input
                      type="number"
                      className="premium-box"
                      value={customPremiums[leg.key] ?? leg.premium}
                      onChange={(e) =>
                        handlePremiumInput(leg.key, e.target.value)
                      }
                      onKeyDown={(e) => handlePremiumKeyDown(e, leg.key)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="strategy-table-container">
        <table className="strategy-table">
          <thead>
            <tr>
              <th>Price at Expiry</th>
              <th>
                {selectedStrategy
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={2}>
                      <div className="skeleton-row" />
                    </td>
                  </tr>
                ))
              : stockInfo?.strategies?.length > 0 && selectedStrategy
              ? stockInfo.strategies.map((row, idx) => (
                  <tr key={idx}>
                    <td>{row["Price at Expiry"]}</td>
                    <td
                      className={`${
                        Number(row[selectedStrategy]) > 0
                          ? "text-green"
                          : Number(row[selectedStrategy]) < 0
                          ? "text-red"
                          : ""
                      }`}
                    >
                      ${Number(row[selectedStrategy]).toFixed(2)}
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default App;
