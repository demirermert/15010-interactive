// Global variables
let chart = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Set up event listeners
    document.getElementById('resetBtn').addEventListener('click', reset);
    
    // Auto-update on input changes
    document.getElementById('demandFormula').addEventListener('input', calculate);
    document.getElementById('supplyFormula').addEventListener('input', calculate);
    document.getElementById('tariff').addEventListener('input', calculate);
    
    // Auto-update on radio button changes
    document.getElementById('tariffOnSuppliers').addEventListener('change', calculate);
    document.getElementById('tariffOnBuyers').addEventListener('change', calculate);
    
    // Auto-update on checkbox changes
    document.getElementById('showConsumerSurplus').addEventListener('change', calculate);
    document.getElementById('showProducerSurplus').addEventListener('change', calculate);
    document.getElementById('showConsumerSurplusWithTariff').addEventListener('change', calculate);
    document.getElementById('showProducerSurplusWithTariff').addEventListener('change', calculate);
    document.getElementById('showTariffRevenue').addEventListener('change', calculate);
    document.getElementById('showDeadweightLoss').addEventListener('change', calculate);
    
    // Show All checkbox handler - doesn't change other checkboxes
    document.getElementById('showAll').addEventListener('change', calculate);
    
    // Calculate with default values on load
    calculate();
});

// Update the "Show All" checkbox based on individual checkbox states
function updateShowAllCheckbox() {
    // No longer auto-update showAll based on other checkboxes
}

// Parse formula string and evaluate for a given Q
function evaluateFormula(formula, Q) {
    try {
        // Replace Q with the actual value
        let expression = formula.replace(/Q/g, Q.toString());
        
        // Support basic math operations
        expression = expression.replace(/\s/g, ''); // Remove spaces
        
        // Evaluate the expression
        return Function('"use strict"; return (' + expression + ')')();
    } catch (error) {
        console.error('Error evaluating formula:', error);
        return null;
    }
}

// Format number to show decimal only if needed
function formatNumber(num) {
    // Round to 1 decimal place
    const rounded = Math.round(num * 10) / 10;
    // If it's a whole number, return without decimal
    if (rounded === Math.floor(rounded)) {
        return rounded.toFixed(0);
    }
    // Otherwise return with 1 decimal place
    return rounded.toFixed(1);
}

// Find equilibrium by solving for intersection
function findEquilibrium(demandFormula, supplyFormula) {
    // Try to solve algebraically by testing different Q values
    // This is a numerical approach
    let bestQ = 0;
    let minDiff = Infinity;
    
    for (let Q = 0; Q <= 200; Q += 0.1) {
        const demandP = evaluateFormula(demandFormula, Q);
        const supplyP = evaluateFormula(supplyFormula, Q);
        
        if (demandP === null || supplyP === null) continue;
        
        const diff = Math.abs(demandP - supplyP);
        if (diff < minDiff) {
            minDiff = diff;
            bestQ = Q;
        }
    }
    
    const equilibriumP = evaluateFormula(demandFormula, bestQ);
    return { Q: bestQ, P: equilibriumP };
}

// Calculate deadweight loss
function calculateDeadweightLoss(eq1, eq2, tariff) {
    // Deadweight loss is the triangle formed by:
    // - The difference in quantities (base)
    // - The tariff amount (height component)
    // Formula: 0.5 * |Q1 - Q2| * tariff
    
    const quantityChange = Math.abs(eq1.Q - eq2.Q);
    const dwl = 0.5 * quantityChange * tariff;
    
    return dwl;
}

// Main calculation function
function calculate() {
    // Get input values
    const demandFormula = document.getElementById('demandFormula').value;
    const supplyFormula = document.getElementById('supplyFormula').value;
    const tariff = parseFloat(document.getElementById('tariff').value) || 0;
    const tariffOnSuppliers = document.getElementById('tariffOnSuppliers').checked;
    
    // Validate inputs
    if (!demandFormula || !supplyFormula) {
        alert('Please enter both demand and supply formulas');
        return;
    }
    
    // Determine which curve to shift based on who pays the tariff
    let demandWithTariff, supplyWithTariff;
    
    // Get the display elements
    const supplyDisplay = document.getElementById('supplyWithTariffDisplay').parentElement;
    const demandDisplay = document.getElementById('demandWithTariffDisplay').parentElement;
    
    if (tariffOnSuppliers) {
        // Tariff on suppliers: shift supply curve up
        demandWithTariff = demandFormula;
        supplyWithTariff = `(${supplyFormula}) + ${tariff}`;
        
        // Always show supply display, hide demand display
        supplyDisplay.style.display = 'block';
        demandDisplay.style.display = 'none';
        
        // Update supply display content
        if (tariff > 0) {
            document.getElementById('supplyWithTariffDisplay').textContent = 'P = (' + supplyFormula + ') + ' + tariff;
        } else {
            document.getElementById('supplyWithTariffDisplay').textContent = '-';
        }
    } else {
        // Tariff on buyers: shift demand curve down
        demandWithTariff = `(${demandFormula}) - ${tariff}`;
        supplyWithTariff = supplyFormula;
        
        // Hide supply display, always show demand display
        supplyDisplay.style.display = 'none';
        demandDisplay.style.display = 'block';
        
        // Update demand display content
        if (tariff > 0) {
            demandDisplay.style.display = 'block';
            document.getElementById('demandWithTariffDisplay').textContent = 'P = (' + demandFormula + ') - ' + tariff;
        } else {
            document.getElementById('demandWithTariffDisplay').textContent = '-';
        }
    }
    
    // Find equilibrium without tariff
    const eqNoTariff = findEquilibrium(demandFormula, supplyFormula);
    
    // Find equilibrium with tariff
    const eqWithTariff = findEquilibrium(demandWithTariff, supplyWithTariff);
    
    // Validate equilibrium results
    if (!eqNoTariff || !eqWithTariff || isNaN(eqNoTariff.P) || isNaN(eqWithTariff.P) || 
        isNaN(eqNoTariff.Q) || isNaN(eqWithTariff.Q)) {
        console.error('Invalid equilibrium calculation');
        return;
    }
    
    // Calculate metrics
    let priceChange;
    if (tariffOnSuppliers) {
        // When suppliers pay: price change is from no tariff to with tariff
        priceChange = eqWithTariff.P - eqNoTariff.P;
    } else {
        // When buyers pay: price change includes the tariff consumers must pay
        priceChange = (eqWithTariff.P + tariff) - eqNoTariff.P;
    }
    const passThroughRate = tariff > 0 ? (priceChange / tariff) * 100 : 0;
    const dwl = calculateDeadweightLoss(eqNoTariff, eqWithTariff, tariff);
    
    // Calculate consumer and producer surplus (without tariff)
    // Consumer Surplus = 0.5 * base * height = 0.5 * Q * (P_max - P_eq)
    // For demand P = 120 - 2Q, when Q=0, P=120 (max price consumers would pay)
    const maxDemandPrice = evaluateFormula(demandFormula, 0);
    const consumerSurplusNoTariff = 0.5 * eqNoTariff.Q * (maxDemandPrice - eqNoTariff.P);
    
    // Producer Surplus = 0.5 * base * height = 0.5 * Q * (P_eq - P_min)
    // For supply P = 2Q, when Q=0, P=0 (min price producers would accept)
    const minSupplyPrice = evaluateFormula(supplyFormula, 0);
    const producerSurplusNoTariff = 0.5 * eqNoTariff.Q * (eqNoTariff.P - minSupplyPrice);
    
    // Calculate consumer and producer surplus (with tariff)
    let consumerSurplusWithTariff, producerSurplusWithTariff;
    
    if (tariffOnSuppliers) {
        // Tariff on suppliers: consumers pay eqWithTariff.P, producers receive eqWithTariff.P - tariff
        consumerSurplusWithTariff = 0.5 * eqWithTariff.Q * (maxDemandPrice - eqWithTariff.P);
        const priceReceivedByProducers = eqWithTariff.P - tariff;
        producerSurplusWithTariff = 0.5 * eqWithTariff.Q * (priceReceivedByProducers - minSupplyPrice);
    } else {
        // Tariff on buyers: consumers pay eqWithTariff.P + tariff, producers receive eqWithTariff.P
        const pricePaidByConsumers = eqWithTariff.P + tariff;
        consumerSurplusWithTariff = 0.5 * eqWithTariff.Q * (maxDemandPrice - pricePaidByConsumers);
        producerSurplusWithTariff = 0.5 * eqWithTariff.Q * (eqWithTariff.P - minSupplyPrice);
    }
    
    // Calculate tariff revenue
    const tariffRevenue = tariff * eqWithTariff.Q;
    
    // Calculate changes in surplus
    const changeConsumerSurplus = consumerSurplusWithTariff - consumerSurplusNoTariff;
    const changeProducerSurplus = producerSurplusWithTariff - producerSurplusNoTariff;
    
    // Update results display
    document.getElementById('eqQuantityNoTariff').textContent = formatNumber(eqNoTariff.Q);
    document.getElementById('eqPriceNoTariff').textContent = '$' + formatNumber(eqNoTariff.P);
    
    // Show/hide consumer and producer surplus based on display options
    const showCSWithTariff = document.getElementById('showConsumerSurplusWithTariff').checked || (document.getElementById('showAll').checked && tariff > 0);
    const showPSWithTariff = document.getElementById('showProducerSurplusWithTariff').checked || (document.getElementById('showAll').checked && tariff > 0);
    
    const showCS = document.getElementById('showConsumerSurplus').checked || document.getElementById('showAll').checked || showCSWithTariff;
    const showPS = document.getElementById('showProducerSurplus').checked || document.getElementById('showAll').checked || showPSWithTariff;
    
    // Always show the rows, but display "-" if not highlighted
    if (showCS) {
        document.getElementById('consumerSurplusNoTariff').textContent = formatNumber(consumerSurplusNoTariff);
    } else {
        document.getElementById('consumerSurplusNoTariff').textContent = '-';
    }
    
    if (showPS) {
        document.getElementById('producerSurplusNoTariff').textContent = formatNumber(producerSurplusNoTariff);
    } else {
        document.getElementById('producerSurplusNoTariff').textContent = '-';
    }
    
    if (tariff > 0) {
        document.getElementById('eqQuantityWithTariff').textContent = formatNumber(eqWithTariff.Q);
        
        // Display the price consumers actually pay
        let priceDisplayText;
        if (tariffOnSuppliers) {
            // Tariff on suppliers: consumers pay the equilibrium price
            document.getElementById('eqPriceWithTariffLabel').textContent = 'Price:';
            priceDisplayText = '$' + formatNumber(eqWithTariff.P);
        } else {
            // Tariff on buyers: show as equilibrium price + tariff
            document.getElementById('eqPriceWithTariffLabel').textContent = 'Total Price:';
            priceDisplayText = '$' + formatNumber(eqWithTariff.P) + '+' + formatNumber(tariff);
        }
        
        document.getElementById('eqPriceWithTariff').textContent = priceDisplayText;
        
        // Update surplus values with tariff based on display options (already defined earlier)
        if (showCSWithTariff) {
            document.getElementById('consumerSurplusWithTariff').textContent = formatNumber(consumerSurplusWithTariff);
        } else {
            document.getElementById('consumerSurplusWithTariff').textContent = '-';
        }
        
        if (showPSWithTariff) {
            document.getElementById('producerSurplusWithTariff').textContent = formatNumber(producerSurplusWithTariff);
        } else {
            document.getElementById('producerSurplusWithTariff').textContent = '-';
        }
        
        document.getElementById('tariffAmountDisplay').textContent = '$' + formatNumber(tariff);
        document.getElementById('priceChange').textContent = '+$' + formatNumber(priceChange);
        document.getElementById('passThroughRate').textContent = formatNumber(passThroughRate) + '%';
        
        // Show/hide tariff revenue and deadweight loss based on display options
        const showTR = document.getElementById('showTariffRevenue').checked || (document.getElementById('showAll').checked && tariff > 0);
        const showDWL = document.getElementById('showDeadweightLoss').checked || (document.getElementById('showAll').checked && tariff > 0);
        
        if (showTR) {
            document.getElementById('tariffRevenueValue').textContent = formatNumber(tariffRevenue);
        } else {
            document.getElementById('tariffRevenueValue').textContent = '-';
        }
        
        if (showDWL) {
            document.getElementById('deadweightLoss').textContent = formatNumber(dwl);
        } else {
            document.getElementById('deadweightLoss').textContent = '-';
        }
        
        if (showCSWithTariff) {
            const csChangeText = (changeConsumerSurplus >= 0 ? '+' : '-') + formatNumber(Math.abs(changeConsumerSurplus));
            document.getElementById('changeConsumerSurplus').textContent = csChangeText;
        } else {
            document.getElementById('changeConsumerSurplus').textContent = '-';
        }
        
        if (showPSWithTariff) {
            const psChangeText = (changeProducerSurplus >= 0 ? '+' : '-') + formatNumber(Math.abs(changeProducerSurplus));
            document.getElementById('changeProducerSurplus').textContent = psChangeText;
        } else {
            document.getElementById('changeProducerSurplus').textContent = '-';
        }
    } else {
        document.getElementById('eqQuantityWithTariff').textContent = '-';
        document.getElementById('eqPriceWithTariffLabel').textContent = 'Price:';
        document.getElementById('eqPriceWithTariff').textContent = '-';
        document.getElementById('consumerSurplusWithTariff').textContent = '-';
        document.getElementById('producerSurplusWithTariff').textContent = '-';
        
        document.getElementById('tariffAmountDisplay').textContent = '-';
        document.getElementById('priceChange').textContent = '-';
        document.getElementById('passThroughRate').textContent = '-';
        document.getElementById('tariffRevenueValue').textContent = '-';
        document.getElementById('deadweightLoss').textContent = '-';
        document.getElementById('changeConsumerSurplus').textContent = '-';
        document.getElementById('changeProducerSurplus').textContent = '-';
        
        // Check if user is trying to view tariff-related options when tariff is zero
        const tariffOptionsChecked = document.getElementById('showConsumerSurplusWithTariff').checked || 
                                     document.getElementById('showProducerSurplusWithTariff').checked ||
                                     document.getElementById('showTariffRevenue').checked ||
                                     document.getElementById('showDeadweightLoss').checked;
        
        if (tariffOptionsChecked) {
            alert('Please enter a tariff amount greater than zero to view tariff analysis.');
            // Uncheck the tariff-related options
            document.getElementById('showConsumerSurplusWithTariff').checked = false;
            document.getElementById('showProducerSurplusWithTariff').checked = false;
            document.getElementById('showTariffRevenue').checked = false;
            document.getElementById('showDeadweightLoss').checked = false;
        }
    }
    
    // Update chart
    updateChart(demandFormula, supplyFormula, demandWithTariff, supplyWithTariff, eqNoTariff, eqWithTariff, tariff, tariffOnSuppliers);
}

// Update the chart with new data
function updateChart(demandFormula, supplyFormula, demandWithTariff, supplyWithTariff, eqNoTariff, eqWithTariff, tariff, tariffOnSuppliers) {
    const ctx = document.getElementById('supplyDemandChart').getContext('2d');
    
    // Check if we should show tariff-related elements
    const showTariff = tariff > 0;
    const showAll = document.getElementById('showAll').checked;
    
    // If "Show All" is checked, determine what to show based on tariff
    let showConsumerSurplus, showProducerSurplus, showConsumerSurplusWithTariff;
    let showProducerSurplusWithTariff, showTariffRevenue, showDeadweightLoss;
    
    if (showAll) {
        if (tariff > 0) {
            // With tariff: show surplus with tariff, tariff revenue, and deadweight loss
            showConsumerSurplus = false;
            showProducerSurplus = false;
            showConsumerSurplusWithTariff = true;
            showProducerSurplusWithTariff = true;
            showTariffRevenue = true;
            showDeadweightLoss = true;
        } else {
            // No tariff: show only basic consumer and producer surplus
            showConsumerSurplus = true;
            showProducerSurplus = true;
            showConsumerSurplusWithTariff = false;
            showProducerSurplusWithTariff = false;
            showTariffRevenue = false;
            showDeadweightLoss = false;
        }
    } else {
        // Use individual checkbox states
        showConsumerSurplus = document.getElementById('showConsumerSurplus').checked;
        showProducerSurplus = document.getElementById('showProducerSurplus').checked;
        showConsumerSurplusWithTariff = document.getElementById('showConsumerSurplusWithTariff').checked;
        showProducerSurplusWithTariff = document.getElementById('showProducerSurplusWithTariff').checked;
        showTariffRevenue = document.getElementById('showTariffRevenue').checked;
        showDeadweightLoss = document.getElementById('showDeadweightLoss').checked;
    }
    
    // Determine which equilibrium to use for surplus calculations
    const eq = showTariff ? eqWithTariff : eqNoTariff;
    const demandForSurplus = showTariff ? demandWithTariff : demandFormula;
    const supplyForSurplus = showTariff ? supplyWithTariff : supplyFormula;
    
    // Generate data points for curves
    const maxQ = Math.max(eqNoTariff.Q, eqWithTariff.Q) * 1.5;
    const quantities = [];
    const demandData = [];
    const supplyData = [];
    const demandWithTariffData = [];
    const supplyWithTariffData = [];
    
    for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
        quantities.push(Q);
        
        const demandP = evaluateFormula(demandFormula, Q);
        const supplyP = evaluateFormula(supplyFormula, Q);
        const demandTariffP = evaluateFormula(demandWithTariff, Q);
        const supplyTariffP = evaluateFormula(supplyWithTariff, Q);
        
        demandData.push(demandP >= 0 ? demandP : null);
        supplyData.push(supplyP >= 0 ? supplyP : null);
        demandWithTariffData.push(demandTariffP >= 0 ? demandTariffP : null);
        supplyWithTariffData.push(supplyTariffP >= 0 ? supplyTariffP : null);
    }
    
    // Generate consumer surplus area (no tariff - triangle below demand curve, above equilibrium price)
    const consumerSurplusData = [];
    if (showConsumerSurplus) {
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q <= eqNoTariff.Q) {
                const demandP = evaluateFormula(demandFormula, Q);
                consumerSurplusData.push(demandP >= eqNoTariff.P ? demandP : eqNoTariff.P);
            } else {
                consumerSurplusData.push(null);
            }
        }
    }
    
    // Generate producer surplus area (no tariff - triangle above supply curve, below equilibrium price)
    const producerSurplusData = [];
    if (showProducerSurplus) {
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q <= eqNoTariff.Q) {
                const supplyP = evaluateFormula(supplyFormula, Q);
                producerSurplusData.push(supplyP <= eqNoTariff.P ? supplyP : eqNoTariff.P);
            } else {
                producerSurplusData.push(null);
            }
        }
    }
    
    // Generate consumer surplus WITH tariff
    const consumerSurplusWithTariffData = [];
    if (showConsumerSurplusWithTariff && showTariff && tariff > 0) {
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q <= eqWithTariff.Q) {
                // Use the shifted demand curve (with tariff) for consumer surplus visualization when tariff is on buyers
                const demandP = tariffOnSuppliers ? evaluateFormula(demandFormula, Q) : evaluateFormula(demandWithTariff, Q);
                consumerSurplusWithTariffData.push(demandP >= eqWithTariff.P ? demandP : eqWithTariff.P);
            } else {
                consumerSurplusWithTariffData.push(null);
            }
        }
    }
    
    // Generate producer surplus WITH tariff
    const producerSurplusWithTariffData = [];
    if (showProducerSurplusWithTariff && showTariff && tariff > 0) {
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q <= eqWithTariff.Q) {
                // Use the shifted supply curve (with tariff) for producer surplus visualization
                const supplyP = tariffOnSuppliers ? evaluateFormula(supplyWithTariff, Q) : evaluateFormula(supplyFormula, Q);
                producerSurplusWithTariffData.push(supplyP <= eqWithTariff.P ? supplyP : eqWithTariff.P);
            } else {
                producerSurplusWithTariffData.push(null);
            }
        }
    }
    
    // Generate tariff revenue area
    const tariffRevenueDataTop = [];
    const tariffRevenueDataBottom = [];
    if (showTariffRevenue && showTariff && tariff > 0) {
        console.log('Calculating tariff revenue, tariffOnSuppliers:', tariffOnSuppliers);
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q <= eqWithTariff.Q) {
                if (tariffOnSuppliers) {
                    // Top boundary: supply with tariff
                    const supplyWithTariffP = evaluateFormula(supplyWithTariff, Q);
                    tariffRevenueDataTop.push(supplyWithTariffP >= 0 ? supplyWithTariffP : null);
                    
                    // Bottom boundary: supply without tariff
                    const supplyNoTariffP = evaluateFormula(supplyFormula, Q);
                    tariffRevenueDataBottom.push(supplyNoTariffP >= 0 ? supplyNoTariffP : null);
                } else {
                    // Top boundary: demand without tariff
                    const demandNoTariffP = evaluateFormula(demandFormula, Q);
                    tariffRevenueDataTop.push(demandNoTariffP >= 0 ? demandNoTariffP : null);
                    
                    // Bottom boundary: demand with tariff
                    const demandWithTariffP = evaluateFormula(demandWithTariff, Q);
                    tariffRevenueDataBottom.push(demandWithTariffP >= 0 ? demandWithTariffP : null);
                }
            } else {
                tariffRevenueDataTop.push(null);
                tariffRevenueDataBottom.push(null);
            }
        }
        console.log('Tariff revenue data length:', tariffRevenueDataBottom.length, 'First few values:', tariffRevenueDataBottom.slice(0, 5));
    }
    
    // Generate deadweight loss area (triangle between demand and supply WITHOUT tariff, from Q with tariff to Q without tariff)
    // Only show if tariff is enabled
    const deadweightLossDataTop = [];
    const deadweightLossDataBottom = [];
    if (showDeadweightLoss && showTariff && tariff > 0) {
        for (let Q = 0; Q <= maxQ; Q += maxQ / 100) {
            if (Q >= eqWithTariff.Q && Q <= eqNoTariff.Q) {
                // Top boundary: demand curve
                const demandP = evaluateFormula(demandFormula, Q);
                deadweightLossDataTop.push(demandP);
                
                // Bottom boundary: supply WITHOUT tariff (original supply)
                const supplyNoTariffP = evaluateFormula(supplyFormula, Q);
                deadweightLossDataBottom.push(supplyNoTariffP);
            } else {
                deadweightLossDataTop.push(null);
                deadweightLossDataBottom.push(null);
            }
        }
    }
    
    // Destroy existing chart if it exists
    if (chart) {
        try {
            chart.destroy();
            chart = null;
        } catch (e) {
            console.log('Error destroying chart:', e);
        }
    }
    
    // Also check if there's any chart instance on this canvas
    const existingChart = Chart.getChart('supplyDemandChart');
    if (existingChart) {
        existingChart.destroy();
    }
    
    // Build datasets array conditionally
    const datasets = [];
    
    try {
        // Add consumer surplus (no tariff) - blue
    if (showConsumerSurplus) {
        datasets.push({
            label: 'Consumer Surplus (No Tariff)',
            data: consumerSurplusData,
            borderColor: 'rgba(59, 130, 246, 0)',
            backgroundColor: 'rgba(59, 130, 246, 0.3)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: {
                target: {value: eqNoTariff.P},
                above: 'rgba(59, 130, 246, 0.3)'
            },
            order: 10
        });
    }
    
    // Add producer surplus (no tariff) - red
    if (showProducerSurplus) {
        datasets.push({
            label: 'Producer Surplus (No Tariff)',
            data: producerSurplusData,
            borderColor: 'rgba(239, 68, 68, 0)',
            backgroundColor: 'rgba(239, 68, 68, 0.3)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: {
                target: {value: eqNoTariff.P},
                below: 'rgba(239, 68, 68, 0.3)'
            },
            order: 10
        });
    }
    
    // Add consumer surplus WITH tariff - light blue
    if (showConsumerSurplusWithTariff && showTariff && tariff > 0) {
        datasets.push({
            label: 'Consumer Surplus (With Tariff)',
            data: consumerSurplusWithTariffData,
            borderColor: 'rgba(59, 130, 246, 0)',
            backgroundColor: 'rgba(147, 197, 253, 0.4)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: {
                target: {value: eqWithTariff.P},
                above: 'rgba(147, 197, 253, 0.4)'
            },
            order: 10
        });
    }
    
    // Add producer surplus WITH tariff - light red/pink
    if (showProducerSurplusWithTariff && showTariff && tariff > 0) {
        datasets.push({
            label: 'Producer Surplus (With Tariff)',
            data: producerSurplusWithTariffData,
            borderColor: 'rgba(239, 68, 68, 0)',
            backgroundColor: 'rgba(252, 165, 165, 0.4)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: {
                target: {value: eqWithTariff.P},
                below: 'rgba(252, 165, 165, 0.4)'
            },
            order: 10
        });
    }
    
    // Add tariff revenue (yellow/gold) - area between two curves
    if (showTariffRevenue && showTariff && tariff > 0 && tariffRevenueDataBottom.length > 0) {
        datasets.push({
            label: 'Tariff Revenue',
            data: tariffRevenueDataBottom,
            borderColor: 'rgba(234, 179, 8, 0.8)',
            backgroundColor: 'rgba(234, 179, 8, 0.4)',
            borderWidth: 2,
            tension: 0.1,
            pointRadius: 0,
            fill: '+1',  // Fill to the next dataset
            order: 9
        });
        datasets.push({
            label: false,  // Don't show in legend
            data: tariffRevenueDataTop,
            borderColor: 'rgba(234, 179, 8, 0)',
            backgroundColor: 'rgba(234, 179, 8, 0)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: false,
            order: 9
        });
    }
    
    // Add deadweight loss (gray) - triangle between demand and supply
    if (showDeadweightLoss && showTariff && tariff > 0 && deadweightLossDataBottom.length > 0) {
        datasets.push({
            label: 'Deadweight Loss',
            data: deadweightLossDataBottom,
            borderColor: 'rgba(107, 114, 128, 0.8)',
            backgroundColor: 'rgba(107, 114, 128, 0.5)',
            borderWidth: 2,
            tension: 0.1,
            pointRadius: 0,
            fill: '+1',  // Fill to the next dataset
            order: 9
        });
        datasets.push({
            label: false,  // Don't show in legend
            data: deadweightLossDataTop,
            borderColor: 'rgba(107, 114, 128, 0)',
            backgroundColor: 'rgba(107, 114, 128, 0)',
            borderWidth: 0,
            tension: 0.1,
            pointRadius: 0,
            fill: false,
            order: 9
        });
    }
    
    // Add main curves
    datasets.push({
        label: 'Demand (No Tariff)',
        data: demandData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        tension: 0.1,
        pointRadius: 0,
        fill: false,
        order: 1
    });
    
    datasets.push({
        label: 'Supply (No Tariff)',
        data: supplyData,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 3,
        tension: 0.1,
        pointRadius: 0,
        fill: false,
        order: 1
    });
    
    // Add demand with tariff curve only if tariff is non-zero and charged to buyers
    if (showTariff && !tariffOnSuppliers) {
        datasets.push({
            label: 'Demand (With Tariff)',
            data: demandWithTariffData,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            borderWidth: 3,
            borderDash: [5, 5],
            tension: 0.1,
            pointRadius: 0,
            fill: false,
            order: 1
        });
    }
    
    // Add supply with tariff curve only if tariff is non-zero and charged to suppliers
    if (showTariff && tariffOnSuppliers) {
        datasets.push({
            label: 'Supply (With Tariff)',
            data: supplyWithTariffData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            borderWidth: 3,
            borderDash: [5, 5],
            tension: 0.1,
            pointRadius: 0,
            fill: false,
            order: 1
        });
    }
    
    // Add equilibrium points
    datasets.push({
        label: 'Equilibrium (No Tariff)',
        data: [{x: eqNoTariff.Q, y: eqNoTariff.P}],
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        pointRadius: 5,
        pointStyle: 'circle',
        showLine: false,
        order: 0
    });
    
    if (showTariff) {
        datasets.push({
            label: 'Equilibrium (With Tariff)',
            data: [{x: eqWithTariff.Q, y: eqWithTariff.P}],
            borderColor: '#8b5cf6',
            backgroundColor: '#8b5cf6',
            pointRadius: 5,
            pointStyle: 'circle',
            showLine: false,
            order: 0
        });
    }
    
    // Custom plugin to add text labels on surplus areas
    const textLabelsPlugin = {
        id: 'textLabels',
        afterDatasetsDraw: function(chartInstance) {
            const ctx = chartInstance.ctx;
            ctx.save();
            
            // Set text style
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Get scales
            const xScale = chartInstance.scales.x;
            const yScale = chartInstance.scales.y;
            
            // Helper function to draw text with background
            function drawLabel(text, x, y) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                const metrics = ctx.measureText(text);
                const padding = 6;
                ctx.fillRect(
                    x - metrics.width / 2 - padding,
                    y - 10,
                    metrics.width + padding * 2,
                    20
                );
                ctx.fillStyle = 'white';
                ctx.fillText(text, x, y);
            }
            
            // Calculate label positions based on visible areas
            // For triangular areas, use centroid formula: (x1+x2+x3)/3, (y1+y2+y3)/3
            
            if (showConsumerSurplus) {
                // Triangle vertices: (0, maxDemandPrice), (eqQ, eqP), (eqQ, eqP)
                // Centroid is at approximately Q = eqQ/3, P = eqP + 2/3*(maxP - eqP)
                const maxDemandPrice = evaluateFormula(demandFormula, 0);
                const xPos = eqNoTariff.Q * 0.33;
                const yPos = eqNoTariff.P + (maxDemandPrice - eqNoTariff.P) * 0.4;
                const x = xScale.getPixelForValue(xPos);
                const y = yScale.getPixelForValue(yPos);
                drawLabel('Cons. Surplus', x, y);
            }
            
            if (showProducerSurplus) {
                // Triangle vertices: (0, minSupplyPrice), (eqQ, eqP), (eqQ, eqP)
                const minSupplyPrice = evaluateFormula(supplyFormula, 0);
                const xPos = eqNoTariff.Q * 0.33;
                const yPos = eqNoTariff.P - (eqNoTariff.P - minSupplyPrice) * 0.4;
                const x = xScale.getPixelForValue(xPos);
                const y = yScale.getPixelForValue(yPos);
                drawLabel('Prod. Surplus', x, y);
            }
            
            if (showConsumerSurplusWithTariff && showTariff && tariff > 0) {
                const demandMax = tariffOnSuppliers ? evaluateFormula(demandFormula, 0) : evaluateFormula(demandWithTariff, 0);
                const xPos = eqWithTariff.Q * 0.33;
                const yPos = eqWithTariff.P + (demandMax - eqWithTariff.P) * 0.4;
                const x = xScale.getPixelForValue(xPos);
                const y = yScale.getPixelForValue(yPos);
                drawLabel('Cons. Surplus', x, y);
            }
            
            if (showProducerSurplusWithTariff && showTariff && tariff > 0) {
                const supplyMin = tariffOnSuppliers ? evaluateFormula(supplyWithTariff, 0) : evaluateFormula(supplyFormula, 0);
                const xPos = eqWithTariff.Q * 0.33;
                const yPos = eqWithTariff.P - (eqWithTariff.P - supplyMin) * 0.4;
                const x = xScale.getPixelForValue(xPos);
                const y = yScale.getPixelForValue(yPos);
                drawLabel('Prod. Surplus', x, y);
            }
            
            if (showTariffRevenue && showTariff && tariff > 0) {
                // Rectangle between two curves, center it
                const xPos = eqWithTariff.Q * 0.45;
                const x = xScale.getPixelForValue(xPos);
                let y;
                if (tariffOnSuppliers) {
                    const supplyP = evaluateFormula(supplyFormula, xPos);
                    const supplyTariffP = evaluateFormula(supplyWithTariff, xPos);
                    y = yScale.getPixelForValue(supplyP + (supplyTariffP - supplyP) * 0.5);
                } else {
                    const demandP = evaluateFormula(demandFormula, xPos);
                    const demandTariffP = evaluateFormula(demandWithTariff, xPos);
                    y = yScale.getPixelForValue(demandTariffP + (demandP - demandTariffP) * 0.5);
                }
                drawLabel('Tariff Revenue', x, y);
            }
            
            if (showDeadweightLoss && showTariff && tariff > 0) {
                // Triangle between the two equilibria
                const xPos = eqWithTariff.Q + (eqNoTariff.Q - eqWithTariff.Q) * 0.55;
                const demandP = evaluateFormula(demandFormula, xPos);
                const supplyP = evaluateFormula(supplyFormula, xPos);
                const x = xScale.getPixelForValue(xPos);
                const y = yScale.getPixelForValue((demandP + supplyP) * 0.5);
                drawLabel('DWL', x, y);
            }
            
            ctx.restore();
        }
    };
    
    // Create new chart
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: quantities,
            datasets: datasets
        },
        plugins: [textLabelsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false,
            interaction: {
                mode: 'point',
                intersect: true
            },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'line',
                            padding: 15,
                            filter: function(legendItem, chartData) {
                                // Only show legends for lines (demand/supply curves and equilibrium points)
                                // Filter out the area fills (consumer surplus, producer surplus, etc.)
                                return legendItem.text && typeof legendItem.text === 'string' && 
                                       !legendItem.text.includes('Consumer Surplus') && 
                                       !legendItem.text.includes('Producer Surplus') && 
                                       !legendItem.text.includes('Tariff Revenue') && 
                                       !legendItem.text.includes('Deadweight Loss');
                            },
                            generateLabels: function(chart) {
                                const datasets = chart.data.datasets;
                                return datasets
                                    .map((dataset, i) => {
                                        const meta = chart.getDatasetMeta(i);
                                        if (meta.hidden || !dataset.label) return null;
                                        
                                        // Filter out area fills
                                        if (dataset.label.includes('Consumer Surplus') || 
                                            dataset.label.includes('Producer Surplus') || 
                                            dataset.label.includes('Tariff Revenue') || 
                                            dataset.label.includes('Deadweight Loss')) {
                                            return null;
                                        }
                                        
                                        // Use larger box for lines, smaller for circles
                                        const isEquilibrium = dataset.label.includes('Equilibrium');
                                        
                                        return {
                                            text: dataset.label,
                                            fillStyle: dataset.backgroundColor,
                                            strokeStyle: dataset.borderColor,
                                            lineWidth: dataset.borderWidth,
                                            lineDash: dataset.borderDash || [],
                                            hidden: false,
                                            index: i,
                                            pointStyle: dataset.pointStyle || 'line',
                                            datasetIndex: i,
                                            boxWidth: isEquilibrium ? 4 : 50,
                                            boxHeight: isEquilibrium ? 4 : 3
                                        };
                                    })
                                    .filter(item => item !== null);
                            }
                        }
                    },
                title: {
                    display: true,
                    text: 'Supply and Demand Curves',
                    font: {
                        size: 18,
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    enabled: true,
                    mode: 'point',
                    intersect: true,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (tooltipItems && tooltipItems.length > 0) {
                                const item = tooltipItems[0];
                                return item.dataset.label || '';
                            }
                            return '';
                        },
                        label: function(context) {
                            const q = formatNumber(context.parsed.x);
                            const p = formatNumber(context.parsed.y);
                            return 'Q = ' + q + ', P = $' + p;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Quantity (Q)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(0);
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Price (P)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                }
            }
        }
    });
    } catch (error) {
        console.error('Error creating chart:', error);
        alert('Error creating chart: ' + error.message);
    }
}

// Reset to default values
function reset() {
    document.getElementById('demandFormula').value = '120 - 2*Q';
    document.getElementById('supplyFormula').value = '2*Q';
    document.getElementById('tariff').value = '0';
    document.getElementById('tariffOnSuppliers').checked = true;
    document.getElementById('showAll').checked = false;
    document.getElementById('showConsumerSurplus').checked = false;
    document.getElementById('showProducerSurplus').checked = false;
    document.getElementById('showConsumerSurplusWithTariff').checked = false;
    document.getElementById('showProducerSurplusWithTariff').checked = false;
    document.getElementById('showTariffRevenue').checked = false;
    document.getElementById('showDeadweightLoss').checked = false;
    calculate();
}

