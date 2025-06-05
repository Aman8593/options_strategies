import { useState, useEffect } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import "./App.css";

const prettyLabel = (raw) =>
  raw.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

const SKELETON_ROW_COUNT = 8; // Number of shimmer rows to show when loading

const App = () => {
  const [ticker, setTicker] = useState("AAPL");
  const [stockInfo, setStockInfo] = useState(null);
  const [error, setError] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [selectedStrike, setSelectedStrike] = useState("");
  const [customPremiums, setCustomPremiums] = useState({});
  const [loading, setLoading] = useState(false); // <- For shimmer

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

  // Premium POST (custom override)
  const fetchCustomStrategyData = async (
    symbol,
    expiry,
    strike,
    updatedPremiums
  ) => {
    setLoading(true);
    try {
      const calls = {};
      const puts = {};
      strategyLegs.forEach((leg) => {
        if (
          leg.strikeLabel.toLowerCase().includes("call") ||
          leg.key.startsWith("call")
        ) {
          calls[leg.strike] = Number(updatedPremiums[leg.key]);
        } else if (
          leg.strikeLabel.toLowerCase().includes("put") ||
          leg.key.startsWith("put")
        ) {
          puts[leg.strike] = Number(updatedPremiums[leg.key]);
        } else {
          calls[leg.strike] = Number(updatedPremiums[leg.key]);
        }
      });

      const payload = { calls, puts };
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

  const handleSearch = (e) => {
    e.preventDefault();
    setSelectedExpiry("");
    setSelectedStrategy("");
    setSelectedStrike("");
    fetchStrategyData(ticker);
  };

  const premiumData =
    stockInfo?.strategies?.[0]?.premium_breakdown?.[selectedStrategy] || {};

  // ---- Extract Legs: Descriptive for Strike, only show strikeLabel for strike ----
  const extractLegs = (strategyPremiums) => {
    const legs = [];
    if (!strategyPremiums || typeof strategyPremiums !== "object") return legs;

    Object.keys(strategyPremiums).forEach((key) => {
      if (key.endsWith("strike")) {
        const strikeKey = key;
        const strike = strategyPremiums[key];
        const premiumKey = key.replace("strike", "premium");
        const premium = strategyPremiums[premiumKey];
        if (premium !== undefined) {
          legs.push({
            key: `${strikeKey}_${strike}`,
            strike,
            premium,
            strikeLabel: prettyLabel(strikeKey),
          });
        }
      }
    });

    if ("strike" in strategyPremiums && "call_premium" in strategyPremiums) {
      legs.push({
        key: "call_" + strategyPremiums.strike,
        strike: strategyPremiums.strike,
        premium: strategyPremiums.call_premium,
        strikeLabel: "Call Strike",
      });
    }
    if ("strike" in strategyPremiums && "put_premium" in strategyPremiums) {
      legs.push({
        key: "put_" + strategyPremiums.strike,
        strike: strategyPremiums.strike,
        premium: strategyPremiums.put_premium,
        strikeLabel: "Put Strike",
      });
    }
    if (
      "strike" in strategyPremiums &&
      "premium" in strategyPremiums &&
      legs.length === 0
    ) {
      legs.push({
        key: "strike_" + strategyPremiums.strike,
        strike: strategyPremiums.strike,
        premium: strategyPremiums.premium,
        strikeLabel: "Strike",
      });
    }
    return legs;
  };
  // ---------------------------------------------------------------------

  const strategyLegs = extractLegs(premiumData);

  // --- Premium Change Handler triggers POST ONLY on Enter ---
  const handlePremiumKeyDown = (e, key) => {
    if (e.key === "Enter") {
      const value = e.target.value;
      setCustomPremiums((prev) => {
        const next = { ...prev, [key]: Number(value) };
        fetchCustomStrategyData(ticker, selectedExpiry, selectedStrike, next);
        return next;
      });
    }
  };

  const handlePremiumInput = (key, value) => {
    // Controlled input: update local state only, don't POST yet
    setCustomPremiums((prev) => ({ ...prev, [key]: value }));
  };

  const LOT_SIZE = 100;
  const getAdjustedPnL = (row) => {
    const basePnL = Number(row[selectedStrategy]);
    const originalPremiums = strategyLegs.reduce(
      (acc, leg) => acc + Number(leg.premium || 0),
      0
    );
    const adjustedPremiums = strategyLegs.reduce(
      (acc, leg) => acc + Number(customPremiums[leg.key] ?? leg.premium),
      0
    );
    const diff = adjustedPremiums - originalPremiums;
    return (basePnL + diff * LOT_SIZE).toFixed(2);
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
                        Number(getAdjustedPnL(row)) > 0
                          ? "text-green"
                          : Number(getAdjustedPnL(row)) < 0
                          ? "text-red"
                          : ""
                      }`}
                    >
                      ${getAdjustedPnL(row)}
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
