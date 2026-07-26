// Global variables
let chart = null;
let optimalPriceChart = null;
let optimalProfitChart = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Auto-update on input changes
    document.getElementById('raPrice').addEventListener('input', function() {
        document.getElementById('raPriceSlider').value = this.value;
        calculate();
    });
    document.getElementById('raPriceSlider').addEventListener('input', function() {
        document.getElementById('raPrice').value = this.value;
        calculate();
    });
    document.getElementById('raQuality').addEventListener('input', function() {
        document.getElementById('raQualitySlider').value = this.value;
        calculate();
    });
    document.getElementById('raQualitySlider').addEventListener('input', function() {
        document.getElementById('raQuality').value = this.value;
        calculate();
    });
    
    // Auto-update on radio button changes
    document.getElementById('baNoResponse').addEventListener('change', calculate);
    document.getElementById('baResponds').addEventListener('change', calculate);
    
    // Make entire mode button clickable
    document.getElementById('modeButton1').addEventListener('click', function() {
        document.getElementById('baNoResponse').checked = true;
        calculate();
    });
    document.getElementById('modeButton2').addEventListener('click', function() {
        document.getElementById('baResponds').checked = true;
        calculate();
    });
    
    // Toggle chart visibility
    document.getElementById('toggleChartBtn').addEventListener('click', function() {
        const chartContainer = document.getElementById('chartContainer');
        const btn = document.getElementById('toggleChartBtn');
        
        if (chartContainer.style.display === 'none') {
            chartContainer.style.display = 'block';
            btn.textContent = '📈 Hide Ryan Air\'s Optimal Strategy by Quality Level (When BA Responds)';
            btn.classList.add('active');
        } else {
            chartContainer.style.display = 'none';
            btn.textContent = '📈 Show Ryan Air\'s Optimal Strategy by Quality Level (When BA Responds)';
            btn.classList.remove('active');
        }
    });
    
    // Calculate with default values on load
    calculate();
    
    // Generate optimal pricing chart
    generateOptimalPricingChart();
});

// Format number to show decimal only if needed
function formatNumber(num, decimals = 1) {
    if (isNaN(num) || !isFinite(num)) return '0';
    // Round to specified decimal places
    const rounded = Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
    // If it's a whole number, return without decimal
    if (rounded === Math.floor(rounded)) {
        return rounded.toFixed(0);
    }
    // Otherwise return with specified decimal places
    return rounded.toFixed(decimals);
}

// Format percentage
function formatPercent(num) {
    return formatNumber(num * 100, 0) + '%';
}

// Calculate market shares using the exact Excel formulas
function calculateMarketShares(raPrice, raQuality, baPrice, baQuality) {
    // Special case: when qualities are equal (Bertrand competition)
    if (Math.abs(raQuality - baQuality) < 0.01) {
        if (raPrice < baPrice) {
            // Ryan Air gets entire market
            return {
                raShare: 1,
                baShare: 0,
                notFlying: 0,
                thetaL: 0,
                thetaH: 0
            };
        } else if (raPrice > baPrice) {
            // BA gets entire market
            return {
                raShare: 0,
                baShare: 1,
                notFlying: 0,
                thetaL: 0,
                thetaH: 0
            };
        } else {
            // Equal prices, split the market
            return {
                raShare: 0.5,
                baShare: 0.5,
                notFlying: 0,
                thetaL: 0,
                thetaH: 0
            };
        }
    }
    
    // Normal case: different qualities
    const A4 = raPrice;
    const B4 = raQuality;
    const A12 = baPrice;
    const B12 = baQuality;
    
    // Ryan Air market share (cell A6):
    // =MIN(1,MAX(0,((A12/1000-A4/1000)/(B12-B4))-(A4/1000)/B4))
    let raShare = 0;
    if (B12 !== B4 && B4 > 0) {
        raShare = ((A12/1000 - A4/1000) / (B12 - B4)) - (A4/1000) / B4;
        raShare = Math.max(0, Math.min(1, raShare));
    }
    
    // British Airways market share (cell A14):
    // =MIN(1-(A12/1000)/B12,MAX(0,1-(A12/1000-A4/1000)/(B12-B4)))
    let baShare = 0;
    if (B12 > 0 && B12 !== B4) {
        const part1 = 1 - (A12/1000) / B12;
        const part2 = Math.max(0, 1 - (A12/1000 - A4/1000) / (B12 - B4));
        baShare = Math.min(part1, part2);
    }
    
    // Not Flying: =1-A6-A14
    const notFlying = Math.max(0, 1 - raShare - baShare);
    
    // Calculate thresholds for display
    const thetaL = (A4/1000) / B4;
    const thetaH = (A12/1000 - A4/1000) / (B12 - B4);
    
    return {
        raShare: raShare,
        baShare: baShare,
        notFlying: notFlying,
        thetaL: thetaL,
        thetaH: thetaH
    };
}

// Calculate BA's optimal response price given RA's price and quality
function calculateBAOptimalPrice(raPrice, raQuality, baQuality) {
    // Special case: when qualities are equal (Bertrand competition)
    // BA's best response is to price $1 less than Ryan Air
    if (Math.abs(raQuality - baQuality) < 0.01) {
        return raPrice - 1; // Undercut by $1
    }
    
    // Normal case: different qualities
    // BA optimal price formula from Excel:
    // =1000*MAX(A4/1000, 0.5*(B12-B4+A4/1000))
    // Where A4=raPrice, B4=raQuality, B12=baQuality
    
    const part1 = raPrice / 1000;
    const part2 = 0.5 * (baQuality - raQuality + raPrice / 1000);
    
    const optimalPrice = 1000 * Math.max(part1, part2);
    
    return optimalPrice;
}

// Main calculation function
function calculate() {
    // Get input values
    const raPrice = parseFloat(document.getElementById('raPrice').value) || 400;
    const raQuality = parseFloat(document.getElementById('raQuality').value) || 4;
    const baResponds = document.getElementById('baResponds').checked;
    
    // BA fixed values
    let baPrice = 1200;
    const baQuality = 6;
    
    // Validate inputs
    if (raQuality <= 0) {
        alert('Quality must be greater than 0');
        return;
    }
    
    // If BA responds, calculate optimal price
    if (baResponds) {
        baPrice = calculateBAOptimalPrice(raPrice, raQuality, baQuality);
        baPrice = Math.round(baPrice); // Round to whole number
        document.getElementById('baPrice').value = baPrice;
        document.getElementById('baPrice').style.backgroundColor = '#fff9e6';
        const hint = document.getElementById('baPrice').nextElementSibling;
        if (hint) {
            hint.textContent = 'BA responds optimally (price will adjust as RA change its price)';
            hint.style.color = '#d97706';
        }
    } else {
        document.getElementById('baPrice').value = 1200;
        document.getElementById('baPrice').style.backgroundColor = '#e8eef9';
        const hint = document.getElementById('baPrice').nextElementSibling;
        if (hint) {
            hint.textContent = 'Fixed at $1,200';
            hint.style.color = '#999';
        }
    }
    
    // Calculate market shares using Excel formulas
    const results = calculateMarketShares(raPrice, raQuality, baPrice, baQuality);
    const raShare = results.raShare;
    const baShare = results.baShare;
    const notFlying = results.notFlying;
    
    // Calculate profits using Excel formulas
    // Ryan Air profit: =A6*A4*100
    const raProfit = raShare * raPrice * 100;
    
    // British Airways profit: =A12*A14*100  
    const baProfit = baShare * baPrice * 100;
    
    // Update displays
    document.getElementById('raPriceDisplay').textContent = '$' + formatNumber(raPrice, 0);
    document.getElementById('raQualityDisplay').textContent = formatNumber(raQuality, 1) + ' in';
    document.getElementById('raMarketShare').textContent = formatPercent(raShare);
    document.getElementById('raProfit').textContent = '$' + formatNumber(raProfit, 0);
    
    document.getElementById('baPriceDisplay').textContent = '$' + formatNumber(baPrice, 0);
    document.getElementById('baQualityDisplay').textContent = formatNumber(baQuality, 1) + ' in';
    document.getElementById('baMarketShare').textContent = formatPercent(baShare);
    document.getElementById('baProfit').textContent = '$' + formatNumber(baProfit, 0);
    
    // Update market bars
    updateMarketBars(raShare, baShare, notFlying);
}

// Update market share bars (stacked vertical chart)
function updateMarketBars(raShare, baShare, notFlying) {
    const raPercent = raShare * 100;
    const baPercent = baShare * 100;
    const nfPercent = notFlying * 100;
    
    // Update heights
    document.getElementById('baStackSegment').style.height = baPercent + '%';
    document.getElementById('raStackSegment').style.height = raPercent + '%';
    document.getElementById('nfStackSegment').style.height = nfPercent + '%';
    
    // Update values (show as percentages like 60%)
    document.getElementById('baStackValue').textContent = formatNumber(baPercent, 0) + '%';
    document.getElementById('raStackValue').textContent = formatNumber(raPercent, 0) + '%';
    document.getElementById('nfStackValue').textContent = formatNumber(nfPercent, 0) + '%';
}

// Reset to default values
function reset() {
    document.getElementById('raPrice').value = '400';
    document.getElementById('raQuality').value = '4';
    document.getElementById('raQualitySlider').value = '4';
    document.getElementById('baNoResponse').checked = true;
    calculate();
}

// Find optimal Ryan Air price for a given quality level when BA responds
function findOptimalRAPrice(raQuality) {
    const baQuality = 6;
    let maxProfit = -Infinity;
    let optimalPrice = 0;
    
    // Search for optimal price from $10 to $3000 in steps of $10
    for (let raPrice = 10; raPrice <= 3000; raPrice += 10) {
        // Calculate BA's response
        const baPrice = calculateBAOptimalPrice(raPrice, raQuality, baQuality);
        
        // Calculate market shares
        const results = calculateMarketShares(raPrice, raQuality, baPrice, baQuality);
        
        // Calculate Ryan Air profit
        const raProfit = results.raShare * raPrice * 100;
        
        // Track maximum
        if (raProfit > maxProfit) {
            maxProfit = raProfit;
            optimalPrice = raPrice;
        }
    }
    
    return { price: optimalPrice, profit: maxProfit };
}

// Generate the optimal pricing chart
function generateOptimalPricingChart() {
    const qualityLevels = [];
    const optimalProfits = [];
    
    // Calculate optimal prices for quality levels from 0.5 to 6.0
    for (let quality = 0.5; quality <= 6.0; quality += 0.1) {
        qualityLevels.push(quality.toFixed(1));
        const result = findOptimalRAPrice(quality);
        optimalProfits.push(result.profit);
    }
    
    // Create Profit Chart
    const ctxProfit = document.getElementById('optimalProfitChart');
    
    if (!ctxProfit) {
        console.error('optimalProfitChart canvas not found');
        return;
    }
    
    if (optimalProfitChart) {
        optimalProfitChart.destroy();
    }
    
    optimalProfitChart = new Chart(ctxProfit.getContext('2d'), {
        type: 'line',
        data: {
            labels: qualityLevels,
            datasets: [{
                label: 'Maximum Profit ($)',
                data: optimalProfits,
                borderColor: '#059669',
                backgroundColor: 'rgba(5, 150, 105, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#059669',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.8,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#2a5298'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Maximum Profit: $' + formatNumber(context.parsed.y, 0);
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Ryan Air Quality (inches)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#2a5298'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Maximum Profit ($)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#2a5298'
                    },
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + formatNumber(value, 0);
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}
