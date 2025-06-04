import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search } from 'lucide-react';
import './App.css';
 
// 🔍 Extract premium for selected strike
const extractPremiumForSelectedStrike = (text, selectedStrike) => {
  if (!text || !selectedStrike) return '';
  const match = text.match(
    new RegExp(`(?:Strike|Buy|Sell|Call Strike|Put Strike):\\s*${selectedStrike}\\s*\\(?([\\d.]*)\\)?`)
  );
  if (match && match[1]) return parseFloat(match[1]);
 
  const fallback = text.match(/Premium:\s*([\d.]+)/);
  return fallback ? parseFloat(fallback[1]) : '';
};
 
// 🔍 Parse all strike-premium legs
const parsePremiumBreakdown = (text) => {
  if (!text) return [];
 
  const regex = /(?:Strike|Buy|Sell|Call Strike|Put Strike):?\s*([\d.]+)(?:\s*\(?([\d.]+)?\)?)?/g;
  const premiumRegex = /(?:Premium|Call Premium|Put Premium):\s*([\d.]+)/g;
 
  const strikes = [...text.matchAll(regex)];
  const premiums = [...text.matchAll(premiumRegex)];
 
  const pairs = [];
 
  for (let i = 0; i < Math.max(strikes.length, premiums.length); i++) {
    const strike = strikes[i]?.[1] || '';
    const premium =
      strikes[i]?.[2] !== undefined
        ? strikes[i][2]
        : premiums[i]?.[1] || '';
 
    if (strike && premium) {
      pairs.push({
        strike: parseFloat(strike),
        premium: parseFloat(premium),
      });
    }
  }
 
  return pairs;
};
 
const App = () => {
  const [ticker, setTicker] = useState('AAPL');
  const [stockInfo, setStockInfo] = useState(null);
  const [error, setError] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [selectedStrike, setSelectedStrike] = useState('');
 
  const fetchStrategyData = async (symbol, expiry = '', strike = '') => {
    try {
      const url = `http://localhost:8000/options-strategy-pnl?ticker=${symbol}` +
        (expiry ? `&expiry=${expiry}` : '') +
        (strike ? `&strike=${strike}` : '');
 
      const res = await axios.get(url);
      const data = res.data;
      setStockInfo(data);
 
      if (!selectedExpiry) {
        setSelectedExpiry(data.expiry || expiry);
      }
 
      if (!selectedStrike) {
        setSelectedStrike(data.selected_strike || data.atm_strike || strike);
      }
 
      setError(null);
    } catch (err) {
      setStockInfo(null);
      setError('Failed to fetch strategy data. Please check the ticker.');
    }
  };
 
  useEffect(() => {
    fetchStrategyData(ticker);
  }, []);
 
  useEffect(() => {
    if (stockInfo) {
      fetchStrategyData(ticker, selectedExpiry, selectedStrike);
    }
  }, [selectedExpiry, selectedStrike]);
 
  useEffect(() => {
    if (
      stockInfo &&
      stockInfo.strategies &&
      stockInfo.strategies.length > 0 &&
      !selectedStrategy
    ) {
      const keys = Object.keys(stockInfo.strategies[0]).filter(
        (k) => k !== 'Price at Expiry' && k !== 'premium_breakdown'
      );
      setSelectedStrategy(keys[0]);
    }
  }, [stockInfo, selectedStrategy]);
 
  const handleSearch = (e) => {
    e.preventDefault();
    setSelectedExpiry('');
    setSelectedStrategy('');
    setSelectedStrike('');
    fetchStrategyData(ticker);
  };
 
  const premium =
    stockInfo?.strategies?.[0]?.premium_breakdown?.[selectedStrategy]
      ? extractPremiumForSelectedStrike(
          stockInfo.strategies[0].premium_breakdown[selectedStrategy],
          selectedStrike
        )
      : '';
 
  const allLegs =
    stockInfo?.strategies?.[0]?.premium_breakdown?.[selectedStrategy]
      ? parsePremiumBreakdown(
          stockInfo.strategies[0].premium_breakdown[selectedStrategy]
        )
      : [];
 
  const filteredLegs = allLegs.filter((leg) => leg.strike !== Number(selectedStrike));
 
  return (
    <div className="app-container">
      {stockInfo && (
        <div className="stock-info">
          <div className="stock-info-header">
            <div className="left-section">
              <h2 className="stock-info-title">
                {stockInfo.ticker} — Current Price: ${stockInfo.current_price}
              </h2>
 
              {/* 🔹 Top row: Expiry, Strategy, Strike, Premium */}
              <div className="selectors-row">
                <label>
                  Expiry:
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
                </label>
 
                <label>
                  Strategy:
                  <select
                    className="dropdown"
                    value={selectedStrategy}
                    onChange={(e) => setSelectedStrategy(e.target.value)}
                  >
                    {stockInfo?.strategies?.[0] &&
                      Object.keys(stockInfo.strategies[0])
                        .filter((key) => key !== 'Price at Expiry' && key !== 'premium_breakdown')
                        .map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {strategy.replace(/_/g, ' ')}
                          </option>
                        ))}
                  </select>
                </label>
 
                <label>
                  Strike:
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
                </label>
 
                <label>
                  Premium:
                  <input
                    type="text"
                    className="premium-box"
                    value={premium}
                    disabled
                  />
                </label>
              </div>
 
              {/* 🔹 Only show legs ≠ selectedStrike */}
              {filteredLegs.length > 0 && (
                <div className="multi-leg-strikes">
                  {filteredLegs.map((leg, index) => (
                    <div key={index} className="strike-premium-row">
                      <label>
                        Strike:
                        <select className="dropdown" value={leg.strike} onChange={() => {}}>
                          {stockInfo.available_strikes?.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Premium:
                        <input
                          type="text"
                          className="premium-box"
                          value={leg.premium}
                          disabled
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
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
        </div>
      )}
 
      {error && <div className="error-message">{error}</div>}
 
      {stockInfo?.strategies?.length > 0 && selectedStrategy && (
        <div className="strategy-table-container">
          <table className="strategy-table">
            <thead>
              <tr>
                <th>Price at Expiry</th>
                <th>{selectedStrategy.replace(/_/g, ' ')}</th>
              </tr>
            </thead>
            <tbody>
              {stockInfo.strategies.map((row, idx) => (
                <tr key={idx}>
                  <td>{row['Price at Expiry']}</td>
                  <td
                    className={`${
                      Number(row[selectedStrategy]) > 0
                        ? 'text-green'
                        : Number(row[selectedStrategy]) < 0
                        ? 'text-red'
                        : ''
                    }`}
                  >
                    ${row[selectedStrategy]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
 
export default App;
 
 