# Airline Competition Lab - Vertical Product Differentiation

An interactive educational tool for exploring game theory concepts in airline competition, specifically vertical product differentiation between Ryan Air and British Airways.

## 🎯 Scenario

You are **Ryan Air**, competing with **British Airways**. Your goal is to optimize Ryan Air's quality (inches of legroom). British Airways just bought new planes, so they cannot respond with quality changes - they can only change prices.

## 📋 Key Concepts

- **Vertical Product Differentiation**: Products differ in quality, and consumers generally agree on which is higher quality
- **Quality-Price Trade-off**: Higher quality allows higher prices, but may not always lead to higher profits
- **Strategic Response**: How competitors react to your moves affects optimal strategy

## 🎮 How to Use

1. **Open `index.html`** in a web browser
2. **Adjust Ryan Air's Price**: Change the price to find optimal profit levels
3. **Adjust Ryan Air's Quality**: Use the slider or input box to change legroom (quality)
4. **Toggle BA Response**: Switch between two scenarios:
   - **BA Cannot Change Price**: BA keeps price at $1,200 (Tab 1 from Excel)
   - **BA Responds Optimally**: BA adjusts price to maximize their profit (Tab 2 from Excel)
5. **Observe Results**: Watch how market shares and profits change in real-time

## 🔢 Game Mechanics

### Market Share Calculation

The game uses the **Vertical Product Differentiation Model**:

- **100 consumers** uniformly distributed on [0,1] representing different willingness to pay (WTP) for quality
- Consumer type **θ** gets utility: **θ × quality - price** from each airline
- Consumers choose the option with highest utility

**Two threshold values determine market segments:**

1. **θ_L = p_L / q_L** (Low threshold)
   - Below this: Don't fly (utility is negative)
   
2. **θ_H = (p_H - p_L) / (q_H - q_L)** (High threshold)
   - Indifference point between low and high quality airlines

**Market Segments:**
- **[0, θ_L]**: Don't fly (10% in default scenario)
- **[θ_L, θ_H]**: Choose low quality airline (30% Ryan Air in default)
- **[θ_H, 1]**: Choose high quality airline (60% British Airways in default)

### Profit Calculation

- **Profit** = (Price / 1000) × Market Share × 100
- Prices are normalized by dividing by 1000 in the model

## 📊 Questions to Explore

1. Starting Ryan Air at quality level of 4, what is Ryan Air's profit-maximizing price, market share, and profits (assuming BA cannot change price)?

2. If Ryan Air moves closer to BA in quality and sets Quality to 5 (assuming BA cannot change price), what happens to Ryan Air's price, market share, and profits?

3. If Ryan Air moves closer to BA in quality and sets Quality to 5 (assuming BA CAN change price), what happens to Ryan Air's price, market share, and profits?

4. Do profits always increase with quality? Can you intuitively explain why or why not?

## 🛠️ Technical Details

Built with:
- HTML5
- CSS3
- Vanilla JavaScript
- Chart.js for visualizations

## 📁 Files

- `index.html` - Main HTML structure
- `app.js` - Game logic and calculations
- `styles.css` - Styling and layout
- `README.md` - This file

## 🎓 Educational Context

This tool is designed for the **15.010/011/0111 Economic Analysis for Business Decisions** course at MIT Sloan School of Management. It accompanies the "Game Theory II: Vertical Product Differentiation Lab" assignment.

## 🚀 Getting Started

Simply open `index.html` in any modern web browser. No installation or server required!

## 📝 Default Values

- **Ryan Air Price**: $400
- **Ryan Air Quality**: 4.0 inches
- **British Airways Price**: $1,200
- **British Airways Quality**: 6.0 inches
- **BA Response Mode**: Cannot change price

## 💡 Tips

- Try different quality levels to see how the market responds
- Compare results between the two BA response modes
- Look for the "sweet spot" where Ryan Air's profit is maximized
- Pay attention to the "Not Flying" segment - if too many people don't fly, both airlines suffer

## 📮 Course Information

**Course**: 15.010/011/0111 - Economic Analysis for Business Decisions  
**Institution**: MIT Sloan School of Management

---

*This is an educational tool designed for academic purposes.*

