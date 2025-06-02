import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search } from 'lucide-react';
import './App.css';

const App = () => {
  const [ticker, setTicker] = useState('AAPL');
  const [stockInfo, setStockInfo] = useState(null);
  const [error, setError] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [selectedStrike, setSelectedStrike] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState('');

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

  // Initial fetch
  useEffect(() => {
    fetchStrategyData(ticker);
  }, []);

  // Re-fetch on expiry or strike change
  useEffect(() => {
    if (stockInfo) {
      fetchStrategyData(ticker, selectedExpiry, selectedStrike);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiry, selectedStrike]);

  // Set default strategy when stockInfo changes
  useEffect(() => {
    if (
      stockInfo &&
      stockInfo.strategies &&
      stockInfo.strategies.length > 0 &&
      !selectedStrategy
    ) {
      const keys = Object.keys(stockInfo.strategies[0]).filter(
        (k) => k !== 'Price at Expiry'
      );
      setSelectedStrategy(keys[0]);
    }
  }, [stockInfo, selectedStrategy]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSelectedExpiry('');
    setSelectedStrike('');
    setSelectedStrategy('');
    fetchStrategyData(ticker);
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

              <div className="selectors">
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
                  Strategy:
                  <select
                    className="dropdown"
                    value={selectedStrategy}
                    onChange={(e) => setSelectedStrategy(e.target.value)}
                  >
                    {stockInfo?.strategies?.[0] &&
                      Object.keys(stockInfo.strategies[0])
                        .filter((key) => key !== 'Price at Expiry')
                        .map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {strategy.replace(/_/g, ' ')}
                          </option>
                        ))}
                  </select>
                </label>
              </div>
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
