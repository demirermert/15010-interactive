# Tariff Analysis Lab - Interactive Web Tool

An interactive website for students to explore supply and demand curves, tariff effects, and economic concepts like equilibrium and deadweight loss.

## Features

- 📊 **Interactive Supply & Demand Visualization**: Real-time graphing of supply and demand curves
- 🎯 **Equilibrium Calculation**: Automatically calculates and displays equilibrium points before and after tariffs
- 📈 **Tariff Analysis**: Shows the effect of tariffs on market equilibrium
- 💰 **Pass-Through Rate**: Calculates what percentage of the tariff is passed to consumers
- 📉 **Deadweight Loss**: Computes and displays the deadweight loss from the tariff
- 🎨 **Modern UI**: Beautiful, responsive design that works on all devices

## How to Use

1. **Open the Website**: Simply open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge)

2. **Enter Your Formulas**:
   - Input the inverse demand formula (e.g., `120 - 2*Q`)
   - Input the inverse supply formula (e.g., `2*Q`)
   - Use `Q` to represent quantity
   - Supports basic math operations: `+`, `-`, `*`, `/`, `()`, and exponents

3. **Set the Tariff**:
   - Enter the tariff amount in thousands of dollars (e.g., `4` for $4,000)

4. **Calculate**:
   - Click "Calculate & Visualize" to see the results
   - The graph will display all curves and equilibrium points
   - Results panel shows detailed calculations

5. **Analyze**:
   - Compare equilibrium before and after tariff
   - See how much of the tariff gets passed to consumers
   - View the deadweight loss from market inefficiency

## Default Example

The tool comes pre-loaded with the lab example:
- **Demand**: P = 120K - 2Q
- **Supply**: P = 2Q  
- **Tariff**: $4K

This corresponds to the GM pricing scenario from the lab handout.

## Formula Format

When entering formulas, use:
- `Q` for quantity
- `*` for multiplication (e.g., `2*Q`)
- Standard math operators: `+`, `-`, `*`, `/`
- Parentheses for grouping: `(120 - Q) / 2`

### Example Formulas:
- Linear demand: `100 - 0.5*Q`
- Linear supply: `10 + 0.3*Q`
- Constant: `50`
- Complex: `(120 - Q) * 0.5 + 10`

## Technical Details

### Technologies Used:
- **HTML5** - Structure and content
- **CSS3** - Modern styling with gradients and animations
- **JavaScript (ES6+)** - Interactive calculations and logic
- **Chart.js** - Beautiful, responsive charts

### Browser Compatibility:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Educational Concepts Covered

### 1. Market Equilibrium
The point where supply equals demand, determining the market price and quantity.

### 2. Tariff Effects
- **Supply Shift**: Tariffs increase production costs, shifting the supply curve upward
- **New Equilibrium**: Results in higher prices and lower quantities

### 3. Pass-Through Rate
The percentage of the tariff that gets passed on to consumers:
```
Pass-Through Rate = (Price Increase / Tariff Amount) × 100%
```

### 4. Deadweight Loss
The loss in economic efficiency due to market distortion:
```
DWL = 0.5 × Quantity Change × Tariff Amount
```

## Lab Questions Guide

This tool helps answer the lab questions:

1. **Q1 - Equilibrium without tariff**: See "Equilibrium Without Tariff" card
2. **Q2 - Equilibrium with tariff**: See "Equilibrium With Tariff" card
3. **Q3 - Pass-through rate**: See "Pass-Through Rate" in the Tariff Analysis card
4. **Q4 - Deadweight loss visualization**: View the graph showing both equilibria
5. **Q5 - Deadweight loss calculation**: See "Deadweight Loss" value

## Customization

Students can experiment with:
- Different demand elasticities (change the slope in demand formula)
- Different supply elasticities (change the slope in supply formula)
- Various tariff amounts
- Non-linear curves (though the tool works best with linear equations)

## No Installation Required

This is a standalone web application that runs entirely in the browser:
- No server needed
- No installation required
- No external dependencies (except Chart.js from CDN)
- Works offline (after first load)

## Tips for Students

1. **Start Simple**: Use the default values first to understand the tool
2. **Experiment**: Try different formulas to see how elasticity affects outcomes
3. **Compare**: Look at how different tariff amounts change the results
4. **Verify**: Use algebra to verify the equilibrium calculations
5. **Visualize**: The graph helps understand the economic concepts intuitively

## Troubleshooting

- **Formula Error**: Make sure to use `*` for multiplication (e.g., `2*Q` not `2Q`)
- **No Graph**: Check that your formulas are valid mathematical expressions
- **Strange Results**: Ensure supply is upward sloping and demand is downward sloping
- **Browser Issues**: Try clearing cache or using a different modern browser

## Credits

Created for MIT Sloan School's "Economic Analysis for Business Decisions" course.

## License

Free to use for educational purposes.

