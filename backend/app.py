from fastapi import FastAPI, Query, Body, Request
from fastapi.responses import JSONResponse
import yfinance as yf
import pandas as pd
from typing import Optional, Dict, List
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOT_SIZE = 100

def normalize_premiums(premium_dict):
    if not premium_dict:
        return {}
    normalized = {}
    for strike, premium in premium_dict.items():
        try:
            float_strike = float(str(strike).replace("$", ""))
            normalized[float_strike] = float(premium)
            normalized[round(float_strike, 2)] = float(premium)
        except Exception:
            continue
    return normalized

class PremiumData(BaseModel):
    calls: Dict[float, float] = {}  # {strike: premium}
    puts: Dict[float, float] = {}   # {strike: premium}

class OptionLeg(BaseModel):
    type: str  # "call" or "put"
    strike: float
    expiry: str  # in ISO format like "2025-06-27"
    action: str  # "buy" or "sell"
    quantity: int
    premium: float

class StrategyRequest(BaseModel):
    spot_price: float
    legs: List[OptionLeg]

class OptionStrategies:
    def __init__(self, price, selected_strike, current_price, calls, puts, user_premiums=None, user_strategy_premiums=None):
        self.price = price
        self.selected_strike = selected_strike
        self.current_price = current_price
        self.calls = calls
        self.puts = puts
        self.user_premiums = user_premiums
        self.user_strategy_premiums = user_strategy_premiums or {}
        self.available_call_strikes = set(self.calls['strike'].values)
        self.available_put_strikes = set(self.puts['strike'].values)

    def get_price(self, df, strike, is_call=True):
        strike = float(strike)
        premium_type = "calls" if is_call else "puts"
        # Custom premium check (calls/puts by strike)
        if self.user_premiums:
            premium_dict = self.user_premiums.calls if is_call else self.user_premiums.puts
            if strike in premium_dict:
                premium = round(premium_dict[strike], 3)
                return premium
        # Fallback to market data
        row = df[df['strike'] == strike]
        if not row.empty:
            bid = row.iloc[0].get('bid', np.nan)
            ask = row.iloc[0].get('ask', np.nan)
            if not pd.isna(bid) and not pd.isna(ask) and bid > 0 and ask > 0:
                premium = round((bid + ask) / 2, 3)
                return premium
            else:
                premium = round(row.iloc[0]['lastPrice'], 3)
                return premium
        available_strikes = self.available_call_strikes if is_call else self.available_put_strikes
        if not available_strikes:
            return 0.0
        closest_strike = min(available_strikes, key=lambda x: abs(x - strike))
        row = df[df['strike'] == closest_strike]
        if not row.empty:
            bid = row.iloc[0].get('bid', np.nan)
            ask = row.iloc[0].get('ask', np.nan)
            if not pd.isna(bid) and not pd.isna(ask) and bid > 0 and ask > 0:
                premium = round((bid + ask) / 2, 3)
                return premium
            else:
                premium = round(row.iloc[0]['lastPrice'], 3)
                return premium
        return 0.0

    def get_nearest_strike(self, target_strike, is_call=True):
        strikes = self.available_call_strikes if is_call else self.available_put_strikes
        if not strikes:
            return target_strike
        return min(strikes, key=lambda x: abs(x - target_strike))
    
    def premium_breakdown(self):
        breakdown = {}

        # Long Call
        call_price = self.get_price(self.calls, self.selected_strike, is_call=True)
        breakdown["long_call"] = {
            "call_strike": self.selected_strike,
            "call_premium": call_price
        }

        # Covered Call (modified)
        call_strike = self.get_nearest_strike(self.selected_strike + 5, is_call=True)
        call_price_covered = self.get_price(self.calls, call_strike, is_call=True)
        breakdown["covered_call"] = {
            "call_strike": call_strike,
            "call_premium": call_price_covered
        }

        # Long Put 
        put_price = self.get_price(self.puts, self.selected_strike, is_call=False)
        breakdown["long_put"] = {
            "put_strike": self.selected_strike,
            "put_premium": put_price
        }
        # Protective Put (modified)
        put_strike = self.get_nearest_strike(self.selected_strike - 5, is_call=False)
        put_price_protect = self.get_price(self.puts, put_strike, is_call=False)
        breakdown["protective_put"] = {
            "put_strike": put_strike,
            "put_premium": put_price_protect
        }

        # Straddle
        breakdown["straddle"] = {
            "call_strike": self.selected_strike,
            "call_premium": call_price,
            "put_strike": self.selected_strike,
            "put_premium": put_price
        }

        # Strangle
        call_strike_strangle = self.get_nearest_strike(self.selected_strike + 5, is_call=True)
        put_strike_strangle = self.get_nearest_strike(self.selected_strike - 5, is_call=False)
        call_premium_strangle = self.get_price(self.calls, call_strike_strangle, is_call=True)
        put_premium_strangle = self.get_price(self.puts, put_strike_strangle, is_call=False)
        breakdown["strangle"] = {
            "call_strike": call_strike_strangle,
            "call_premium": call_premium_strangle,
            "put_strike": put_strike_strangle,
            "put_premium": put_premium_strangle
        }

        # Bull Call Spread (Debit)
        upper = self.get_nearest_strike(self.selected_strike + 10, is_call=True)
        lower_price = call_price
        upper_price = self.get_price(self.calls, upper, is_call=True)
        breakdown["bull_call_spread"] = {
            "buy_strike": self.selected_strike,
            "buy_premium": lower_price,
            "sell_strike": upper,
            "sell_premium": upper_price
        }

        # Bear Put Spread (Debit)
        higher = self.get_nearest_strike(self.selected_strike + 10, is_call=False)
        premium_bought = self.get_price(self.puts, higher, is_call=False)
        premium_sold = put_price
        breakdown["bear_put_spread"] = {
            "buy_strike": higher,
            "buy_premium": premium_bought,
            "sell_strike": self.selected_strike,
            "sell_premium": premium_sold
        }

        # Bear Call Spread (Credit)
        lower_bear_call = self.selected_strike - 10
        premium_sold_bear_call = self.get_price(self.calls, lower_bear_call, is_call=True)
        premium_bought_bear_call = call_price
        breakdown["bear_call_spread"] = {
            "sell_strike": lower_bear_call,
            "sell_premium": premium_sold_bear_call,
            "buy_strike": self.selected_strike,
            "buy_premium": premium_bought_bear_call
        }

        # Bull Put Spread (Credit)
        lower_bull_put = self.selected_strike
        higher_bull_put = lower_bull_put + 10
        premium_sold_bull_put = put_price
        premium_bought_bull_put = self.get_price(self.puts, higher_bull_put, is_call=False)
        breakdown["bull_put_spread"] = {
            "sell_strike": lower_bull_put,
            "sell_premium": premium_sold_bull_put,
            "buy_strike": higher_bull_put,
            "buy_premium": premium_bought_bull_put
        }

        # Iron Condor
        put_sell = self.get_nearest_strike(self.selected_strike - 5, is_call=False)
        put_buy = self.get_nearest_strike(put_sell - 5, is_call=False)
        call_sell = self.get_nearest_strike(self.selected_strike + 5, is_call=True)
        call_buy = self.get_nearest_strike(call_sell + 5, is_call=True)
        breakdown["iron_condor"] = {
            "put_buy_strike": put_buy,
            "put_buy_premium": self.get_price(self.puts, put_buy, is_call=False),
            "put_sell_strike": put_sell,
            "put_sell_premium": self.get_price(self.puts, put_sell, is_call=False),
            "call_sell_strike": call_sell,
            "call_sell_premium": self.get_price(self.calls, call_sell, is_call=True),
            "call_buy_strike": call_buy,
            "call_buy_premium": self.get_price(self.calls, call_buy, is_call=True)
        }

        # Butterfly Spread
        lower_butterfly = self.get_nearest_strike(self.selected_strike - 10, is_call=True)
        upper_butterfly = self.get_nearest_strike(self.selected_strike + 10, is_call=True)
        lower_price_butterfly = self.get_price(self.calls, lower_butterfly, is_call=True)
        center_price_butterfly = call_price
        upper_price_butterfly = self.get_price(self.calls, upper_butterfly, is_call=True)
        breakdown["butterfly_spread"] = {
            "buy_lower_strike": lower_butterfly,
            "buy_lower_premium": lower_price_butterfly,
            "sell_center_strike": self.selected_strike,
            "sell_center_premium": center_price_butterfly,
            "buy_upper_strike": upper_butterfly,
            "buy_upper_premium": upper_price_butterfly
        }

        return breakdown

    def long_call(self):
        strat_prem = self.user_strategy_premiums.get("long_call", {})
        call_price = strat_prem.get("call_premium")
        if call_price is None:
            call_price = self.get_price(self.calls, self.selected_strike, is_call=True)
        profit = (max(self.price - self.selected_strike, 0) - call_price) * LOT_SIZE
        return round(profit, 3)

    def long_put(self):
        strat_prem = self.user_strategy_premiums.get("long_put", {})
        put_price = strat_prem.get("put_premium")
        if put_price is None:
            put_price = self.get_price(self.puts, self.selected_strike, is_call=False)
        profit = (max(self.selected_strike - self.price, 0) - put_price) * LOT_SIZE
        return round(profit, 3)

    def covered_call(self):
        strat_prem = self.user_strategy_premiums.get("covered_call", {})
        call_strike = self.get_nearest_strike(self.selected_strike + 5, is_call=True)
        call_price = strat_prem.get("call_premium")
        if call_price is None:
            call_price = self.get_price(self.calls, call_strike, is_call=True)
        profit = ((self.price - self.current_price) + call_price - max(self.price - call_strike, 0)) * LOT_SIZE
        return round(profit, 3)

    def protective_put(self):
        strat_prem = self.user_strategy_premiums.get("protective_put", {})
        put_strike = self.get_nearest_strike(self.selected_strike - 5, is_call=False)
        put_price = strat_prem.get("put_premium")
        if put_price is None:
            put_price = self.get_price(self.puts, put_strike, is_call=False)
        profit = ((self.price - self.current_price) - put_price + max(put_strike - self.price, 0)) * LOT_SIZE
        return round(profit, 3)

    def straddle(self):
        strat_prem = self.user_strategy_premiums.get("straddle", {})
        call_price = strat_prem.get("call_premium")
        put_price = strat_prem.get("put_premium")
        if call_price is None:
            call_price = self.get_price(self.calls, self.selected_strike, is_call=True)
        if put_price is None:
            put_price = self.get_price(self.puts, self.selected_strike, is_call=False)
        profit = (max(self.price - self.selected_strike, 0) + max(self.selected_strike - self.price, 0) - call_price - put_price) * LOT_SIZE
        return round(profit, 3)

    def strangle(self):
        strat_prem = self.user_strategy_premiums.get("strangle", {})
        call_strike = self.get_nearest_strike(self.selected_strike + 5, is_call=True)
        put_strike = self.get_nearest_strike(self.selected_strike - 5, is_call=False)
        call_premium = strat_prem.get("call_premium")
        put_premium = strat_prem.get("put_premium")
        if call_premium is None:
            call_premium = self.get_price(self.calls, call_strike, is_call=True)
        if put_premium is None:
            put_premium = self.get_price(self.puts, put_strike, is_call=False)
        profit_per_unit = (max(self.price - call_strike, 0) + max(put_strike - self.price, 0) - (call_premium + put_premium))
        return round(profit_per_unit * LOT_SIZE, 2)

    def bull_call_spread(self):
        strat_prem = self.user_strategy_premiums.get("bull_call_spread", {})
        lower = self.selected_strike
        upper = self.get_nearest_strike(lower + 10, is_call=True)
        lower_price = strat_prem.get("buy_premium")
        upper_price = strat_prem.get("sell_premium")
        if lower_price is None:
            lower_price = self.get_price(self.calls, lower, is_call=True)
        if upper_price is None:
            upper_price = self.get_price(self.calls, upper, is_call=True)
        profit = (max(self.price - lower, 0) - max(self.price - upper, 0) - (lower_price - upper_price)) * LOT_SIZE
        return round(profit, 3)

    def bear_put_spread(self):
        strat_prem = self.user_strategy_premiums.get("bear_put_spread", {})
        lower = self.selected_strike
        higher = self.get_nearest_strike(lower + 10, is_call=False)
        premium_bought = strat_prem.get("buy_premium")
        premium_sold = strat_prem.get("sell_premium")
        if premium_bought is None:
            premium_bought = self.get_price(self.puts, higher, is_call=False)
        if premium_sold is None:
            premium_sold = self.get_price(self.puts, lower, is_call=False)
        net_payoff = max(higher - self.price, 0) - max(lower - self.price, 0)
        profit_per_unit = net_payoff - (premium_bought - premium_sold)
        return round(profit_per_unit * LOT_SIZE, 2)

    def bear_call_spread(self):
        strat_prem = self.user_strategy_premiums.get("bear_call_spread", {})
        upper = self.selected_strike
        lower = upper - 10
        premium_sold = strat_prem.get("sell_premium")
        premium_bought = strat_prem.get("buy_premium")
        if premium_sold is None:
            premium_sold = self.get_price(self.calls, lower, is_call=True)
        if premium_bought is None:
            premium_bought = self.get_price(self.calls, upper, is_call=True)
        net_payoff = max(self.price - lower, 0) - max(self.price - upper, 0)
        profit_per_unit = (premium_sold - premium_bought) - net_payoff
        return round(profit_per_unit * LOT_SIZE, 2)

    def bull_put_spread(self):
        strat_prem = self.user_strategy_premiums.get("bull_put_spread", {})
        lower = self.selected_strike
        higher = lower + 10
        premium_sold = strat_prem.get("sell_premium")
        premium_bought = strat_prem.get("buy_premium")
        if premium_sold is None:
            premium_sold = self.get_price(self.puts, lower, is_call=False)
        if premium_bought is None:
            premium_bought = self.get_price(self.puts, higher, is_call=False)
        net_payoff = max(lower - self.price, 0) - max(higher - self.price, 0)
        profit_per_unit = (premium_sold - premium_bought) - net_payoff
        return round(profit_per_unit * LOT_SIZE, 2)

    def iron_condor(self):
        strat_prem = self.user_strategy_premiums.get("iron_condor", {})
        put_sell = self.get_nearest_strike(round(self.selected_strike - 5, 2), is_call=False)
        put_buy = self.get_nearest_strike(round(put_sell - 5, 2), is_call=False)
        call_sell = self.get_nearest_strike(round(self.selected_strike + 5, 2), is_call=True)
        call_buy = self.get_nearest_strike(round(call_sell + 5, 2), is_call=True)
        premium_put_sell = strat_prem.get("put_sell_premium")
        premium_put_buy = strat_prem.get("put_buy_premium")
        premium_call_sell = strat_prem.get("call_sell_premium")
        premium_call_buy = strat_prem.get("call_buy_premium")
        if premium_put_sell is None:
            premium_put_sell = self.get_price(self.puts, put_sell, is_call=False)
        if premium_put_buy is None:
            premium_put_buy = self.get_price(self.puts, put_buy, is_call=False)
        if premium_call_sell is None:
            premium_call_sell = self.get_price(self.calls, call_sell, is_call=True)
        if premium_call_buy is None:
            premium_call_buy = self.get_price(self.calls, call_buy, is_call=True)

        net_credit = premium_put_sell - premium_put_buy + premium_call_sell - premium_call_buy

        if self.price <= put_buy:
            profit = (net_credit - (put_sell - put_buy)) * LOT_SIZE
        elif self.price <= put_sell:
            profit = (net_credit - (put_sell - self.price)) * LOT_SIZE
        elif self.price <= call_sell:
            profit = net_credit * LOT_SIZE
        elif self.price <= call_buy:
            profit = (net_credit - (self.price - call_sell)) * LOT_SIZE
        else:
            profit = (net_credit - (call_buy - call_sell)) * LOT_SIZE

        return round(profit, 3)

    def butterfly_spread(self):
        strat_prem = self.user_strategy_premiums.get("butterfly_spread", {})
        center = self.selected_strike
        lower = self.get_nearest_strike(center - 10, is_call=True)
        upper = self.get_nearest_strike(center + 10, is_call=True)
        lower_price = strat_prem.get("buy_lower_premium")
        center_price = strat_prem.get("sell_center_premium")
        upper_price = strat_prem.get("buy_upper_premium")
        if lower_price is None:
            lower_price = self.get_price(self.calls, lower, is_call=True)
        if center_price is None:
            center_price = self.get_price(self.calls, center, is_call=True)
        if upper_price is None:
            upper_price = self.get_price(self.calls, upper, is_call=True)
        net_debit = lower_price + upper_price - 2 * center_price
        lower_call_payoff = max(self.price - lower, 0)
        center_call_payoff = max(self.price - center, 0)
        upper_call_payoff = max(self.price - upper, 0)
        net_payoff = lower_call_payoff + upper_call_payoff - 2 * center_call_payoff
        profit = (net_payoff - net_debit) * LOT_SIZE
        return round(profit, 2)

@app.get("/options-strategy-pnl")
def get_strategy_pnl(
    ticker: str = Query(...), 
    expiry: Optional[str] = Query(None), 
    strike: Optional[float] = Query(None)
):
    try:
        stock = yf.Ticker(ticker.upper())
        current_price = stock.history(period='1d')['Close'].iloc[-1]
        if pd.isna(current_price) or current_price <= 0:
            return JSONResponse({"error": f"Invalid price data for {ticker}."}, status_code=400)

        expiry_list = stock.options
        if not expiry_list:
            return JSONResponse({"error": "No options data available."}, status_code=400)

        available_expiries = expiry_list[:4]
        selected_expiry = expiry if expiry in expiry_list else expiry_list[0]
        opt_chain = stock.option_chain(selected_expiry)
        calls = opt_chain.calls
        puts = opt_chain.puts

        valid_call_strikes = set(calls['strike'])
        valid_put_strikes = set(puts['strike'])
        valid_strikes = sorted(valid_call_strikes.union(valid_put_strikes))

        atm_strike = min(valid_strikes, key=lambda x: abs(x - current_price))
        selected_strike = strike if strike in valid_strikes else atm_strike

        atm_index = valid_strikes.index(atm_strike)
        start_idx = max(0, atm_index - 7)
        end_idx = min(len(valid_strikes), atm_index + 8)
        available_strikes = valid_strikes[start_idx:end_idx]

        lower_bound = selected_strike * 0.9
        upper_bound = selected_strike * 1.1
        price_points = [s for s in valid_strikes if lower_bound <= s <= upper_bound]

        results = []
        for price in price_points:
            row = {'Price at Expiry': f"${round(price, 2)}"}
            strategies = OptionStrategies(price, selected_strike, current_price, calls, puts)
            for strat in [
                "long_call", "long_put", "covered_call", "protective_put",
                "straddle", "strangle", "bull_call_spread", "bear_put_spread",
                "bear_call_spread", "bull_put_spread", "iron_condor", "butterfly_spread"
            ]:
                try:
                    pnl = getattr(strategies, strat)()
                    row[strat] = round(pnl, 2) if pnl is not None else "N/A"
                except Exception:
                    row[strat] = "N/A"
            row['premium_breakdown'] = strategies.premium_breakdown()
            results.append(row)

        df = pd.DataFrame(results)

        call_premiums = {}
        put_premiums = {}

        for strike in sorted(valid_call_strikes):
            row = calls[calls['strike'] == strike]
            if not row.empty:
                bid = row.iloc[0].get('bid', np.nan)
                ask = row.iloc[0].get('ask', np.nan)
                mid_price = (bid + ask) / 2 if bid > 0 and ask > 0 else row.iloc[0]['lastPrice']
                call_premiums[round(strike, 2)] = round(mid_price, 3)

        for strike in sorted(valid_put_strikes):
            row = puts[puts['strike'] == strike]
            if not row.empty:
                bid = row.iloc[0].get('bid', np.nan)
                ask = row.iloc[0].get('ask', np.nan)
                mid_price = (bid + ask) / 2 if bid > 0 and ask > 0 else row.iloc[0]['lastPrice']
                put_premiums[round(strike, 2)] = round(mid_price, 3)

        return {
            "ticker": ticker.upper(),
            "current_price": round(current_price, 2),
            "atm_strike": round(atm_strike, 2),
            "selected_strike": round(selected_strike, 2),
            "expiry": selected_expiry,
            "available_expiries": available_expiries,
            "available_strikes": [round(s, 2) for s in available_strikes],
            "strategies": df.to_dict(orient="records"),
            "premiums": {
                "calls": call_premiums,
                "puts": put_premiums
            }
        }

    except Exception as e:
        return JSONResponse(content={"error": f"An error occurred: {str(e)}"}, status_code=500)

@app.post("/options-strategy-pnl-custom")
async def get_strategy_pnl_custom(
    ticker: str = Query(...),
    expiry: Optional[str] = Query(None),
    strike: Optional[float] = Query(None),
    request: Request = None
):
    json_body = await request.json()
    premium_data = None
    strategy_premiums = {}

    # Accept both old (calls/puts) and new (per-strategy) payloads
    if "calls" in json_body or "puts" in json_body:
        premium_data = PremiumData(**json_body)
        premium_data.calls = normalize_premiums(premium_data.calls)
        premium_data.puts = normalize_premiums(premium_data.puts)
    else:
        strategy_premiums = json_body  # e.g. {"bull_call_spread": {"buy_premium": ...}}

    try:
        stock = yf.Ticker(ticker.upper())
        current_price = stock.history(period='1d')['Close'].iloc[-1]
        if pd.isna(current_price) or current_price <= 0:
            return JSONResponse({"error": f"Invalid price data for {ticker}."}, status_code=400)

        expiry_list = stock.options
        if not expiry_list:
            return JSONResponse({"error": "No options data available."}, status_code=400)

        available_expiries = expiry_list[:4]
        selected_expiry = expiry if expiry in expiry_list else expiry_list[0]
        opt_chain = stock.option_chain(selected_expiry)
        calls = opt_chain.calls
        puts = opt_chain.puts

        valid_call_strikes = set(calls['strike'])
        valid_put_strikes = set(puts['strike'])
        valid_strikes = sorted(valid_call_strikes.union(valid_put_strikes))

        atm_strike = min(valid_strikes, key=lambda x: abs(x - current_price))
        selected_strike = strike if strike in valid_strikes else atm_strike

        atm_index = valid_strikes.index(atm_strike)
        start_idx = max(0, atm_index - 7)
        end_idx = min(len(valid_strikes), atm_index + 8)
        available_strikes = valid_strikes[start_idx:end_idx]

        lower_bound = selected_strike * 0.9
        upper_bound = selected_strike * 1.1
        price_points = [s for s in valid_strikes if lower_bound <= s <= upper_bound]

        results = []
        for price in price_points:
            row = {'Price at Expiry': f"${round(price, 2)}"}
            strategies = OptionStrategies(
                price, selected_strike, current_price, calls, puts,
                user_premiums=premium_data, user_strategy_premiums=strategy_premiums
            )
            for strat in [
                "long_call", "long_put", "covered_call", "protective_put",
                "straddle", "strangle", "bull_call_spread", "bear_put_spread",
                "bear_call_spread", "bull_put_spread", "iron_condor", "butterfly_spread"
            ]:
                try:
                    pnl = getattr(strategies, strat)()
                    row[strat] = round(pnl, 2) if pnl is not None else "N/A"
                except Exception:
                    row[strat] = "N/A"
            row['premium_breakdown'] = strategies.premium_breakdown()
            results.append(row)

        df = pd.DataFrame(results)

        # Build premium summary
        call_premiums = {}
        put_premiums = {}

        for strike in sorted(valid_call_strikes):
            row = calls[calls['strike'] == strike]
            if not row.empty:
                bid = row.iloc[0].get('bid', np.nan)
                ask = row.iloc[0].get('ask', np.nan)
                mid_price = (bid + ask) / 2 if bid > 0 and ask > 0 else row.iloc[0]['lastPrice']
                call_premiums[round(strike, 2)] = round(mid_price, 3)

        for strike in sorted(valid_put_strikes):
            row = puts[puts['strike'] == strike]
            if not row.empty:
                bid = row.iloc[0].get('bid', np.nan)
                ask = row.iloc[0].get('ask', np.nan)
                mid_price = (bid + ask) / 2 if bid > 0 and ask > 0 else row.iloc[0]['lastPrice']
                put_premiums[round(strike, 2)] = round(mid_price, 3)

        # Override with user provided premiums (if any)
        if premium_data:
            call_premiums.update({round(k, 2): round(v, 3) for k, v in premium_data.calls.items()})
            put_premiums.update({round(k, 2): round(v, 3) for k, v in premium_data.puts.items()})

        return {
            "ticker": ticker.upper(),
            "current_price": round(current_price, 2),
            "atm_strike": round(atm_strike, 2),
            "selected_strike": round(selected_strike, 2),
            "expiry": selected_expiry,
            "available_expiries": available_expiries,
            "available_strikes": [round(s, 2) for s in available_strikes],
            "strategies": df.to_dict(orient="records"),
            "premiums": {
                "calls": call_premiums,
                "puts": put_premiums
            },
            "user_provided_premiums": {
                "calls": premium_data.calls if premium_data else {},
                "puts": premium_data.puts if premium_data else {},
            
            }
        }

    except Exception as e:
        return JSONResponse(content={"error": f"An error occurred: {str(e)}"}, status_code=500)