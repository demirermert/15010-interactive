// Global variables
let chart = null;
let regionCounter = 0;
let originalSupplyData = null;
let originalRegions = null;
let originalEquilibrium = null;
let originalDemandIntercept = null;
let originalDemandSlope = null;
let showComparison = false;

// Default regions data
const defaultRegions = [
    { name: "Saudi Arabia", capacity: 12, cost: 20 },
    { name: "Other Middle East", capacity: 19, cost: 23 },
    { name: "Russian Federation", capacity: 11, cost: 27 },
    { name: "China", capacity: 5, cost: 30 },
    { name: "Libya", capacity: 2, cost: 35 },
    { name: "Mexico", capacity: 4, cost: 42 },
    { name: "Other S. America / Europe / Eurasia / Africa", capacity: 20, cost: 48 },
    { name: "UK North Sea", capacity: 3, cost: 55 },
    { name: "Other North America", capacity: 15, cost: 50 },
    { name: "Brazil Deep Water", capacity: 3, cost: 59 },
    { name: "U.S. Gulf of Mexico Deep Water", capacity: 2, cost: 62 },
    { name: "Angola Deep Water", capacity: 2, cost: 65 },
    { name: "Nigeria Deep Water", capacity: 3, cost: 78 },
    { name: "Canada Oil Sands", capacity: 7, cost: 85 },
    { name: "Other South & North America", capacity: 8, cost: 97.5 }
];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Set up event listeners
    document.getElementById('calculateBtn').addEventListener('click', enableComparison);
    document.getElementById('resetBtn').addEventListener('click', reset);
    document.getElementById('showDemand').addEventListener('change', calculate);
    document.getElementById('demandIntercept').addEventListener('input', () => {
        // Enable comparison mode when user starts editing demand
        if (originalDemandIntercept !== null) {
            showComparison = true;
        }
        clearTimeout(window.updateTimer);
        window.updateTimer = setTimeout(calculate, 500);
    });
    document.getElementById('demandSlope').addEventListener('input', () => {
        // Enable comparison mode when user starts editing demand
        if (originalDemandSlope !== null) {
            showComparison = true;
        }
        clearTimeout(window.updateTimer);
        window.updateTimer = setTimeout(calculate, 500);
    });
    
    // Load default regions
    reset();
});

// Add a new region input row
function addRegion(regionData = null) {
    const container = document.getElementById('regionsContainer');
    const regionId = regionCounter++;
    
    const row = document.createElement('tr');
    row.className = 'region-row';
    row.id = `region-${regionId}`;
    
    const name = regionData ? regionData.name : 'New Region';
    const capacity = regionData ? regionData.capacity : '';
    const cost = regionData ? regionData.cost : '';
    
    row.innerHTML = `
        <td class="region-name-cell">
            <input type="text" class="region-name" value="${name}" placeholder="Region Name">
        </td>
        <td class="region-capacity-cell">
            <input type="number" class="region-capacity" value="${capacity}" min="0" step="1" placeholder="0">
        </td>
        <td class="region-cost-cell">
            <input type="number" class="region-cost" value="${cost}" min="0" step="1" placeholder="0">
        </td>
    `;
    
    container.appendChild(row);
    
    // Add event listeners for auto-update
    const inputs = row.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            // Enable comparison mode when user starts editing
            if (originalSupplyData !== null) {
                showComparison = true;
            }
            clearTimeout(window.updateTimer);
            window.updateTimer = setTimeout(calculate, 500);
        });
    });
}

// Remove a region
function removeRegion(regionId) {
    const regionDiv = document.getElementById(`region-${regionId}`);
    if (regionDiv) {
        regionDiv.remove();
        calculate();
    }
}

// Collect region data from inputs
function collectRegionData() {
    const regions = [];
    const regionRows = document.querySelectorAll('.region-row');
    
    regionRows.forEach((row) => {
        const name = row.querySelector('.region-name').value.trim();
        const capacity = parseFloat(row.querySelector('.region-capacity').value) || 0;
        const cost = parseFloat(row.querySelector('.region-cost').value) || 0;
        
        if (name && capacity > 0 && cost >= 0) {
            regions.push({ name, capacity, cost });
        }
    });
    
    return regions;
}

// Calculate and update the visualization
function calculate() {
    const regions = collectRegionData();
    
    if (regions.length === 0) {
        alert('Please add at least one region with valid data');
        return;
    }
    
    // Sort regions by cost (ascending)
    regions.sort((a, b) => a.cost - b.cost);
    
    // Calculate cumulative capacity
    let cumulativeCapacity = 0;
    const supplyData = [];
    
    regions.forEach((region, index) => {
        const startQ = cumulativeCapacity;
        const endQ = cumulativeCapacity + region.capacity;
        
        // Add many points along the horizontal section for better hover detection
        const numPoints = 20; // Number of points to add along each horizontal section
        for (let i = 0; i <= numPoints; i++) {
            const q = startQ + (endQ - startQ) * (i / numPoints);
            supplyData.push({
                quantity: q,
                price: region.cost,
                region: region.name,
                isHorizontal: true
            });
        }
        
        cumulativeCapacity = endQ;
        
        // Add vertical connector to next region (if not last region)
        if (index < regions.length - 1) {
            const nextCost = regions[index + 1].cost;
            const numVerticalPoints = 10; // Points along vertical section
            
            for (let i = 0; i <= numVerticalPoints; i++) {
                const p = region.cost + (nextCost - region.cost) * (i / numVerticalPoints);
                supplyData.push({
                    quantity: cumulativeCapacity,
                    price: p,
                    region: null, // No region for vertical section
                    isHorizontal: false
                });
            }
        }
    });
    
    // Store original data on first calculation (only once)
    if (originalSupplyData === null) {
        originalSupplyData = JSON.parse(JSON.stringify(supplyData));
        originalRegions = JSON.parse(JSON.stringify(regions));
    }
    
    // Calculate summary statistics
    const totalCapacity = regions.reduce((sum, r) => sum + r.capacity, 0);
    const avgCost = regions.reduce((sum, r) => sum + (r.cost * r.capacity), 0) / totalCapacity;
    const lowestCost = Math.min(...regions.map(r => r.cost));
    const highestCost = Math.max(...regions.map(r => r.cost));
    
    // Calculate equilibrium
    const demandIntercept = parseFloat(document.getElementById('demandIntercept').value) || 120;
    const demandSlope = parseFloat(document.getElementById('demandSlope').value) || 0.6;
    const showDemandCurve = document.getElementById('showDemand').checked;
    const equilibrium = findEquilibrium(supplyData, demandIntercept, demandSlope);
    
    // Store original demand parameters on first calculation (only once)
    if (originalDemandIntercept === null) {
        originalDemandIntercept = demandIntercept;
        originalDemandSlope = demandSlope;
    }
    
    // Store original equilibrium on first calculation (only once)
    if (originalEquilibrium === null && equilibrium) {
        originalEquilibrium = { ...equilibrium };
    }
    
    // Update original equilibrium display (only if demand curve is shown)
    if (showDemandCurve && originalEquilibrium) {
        document.getElementById('eqPriceOriginal').textContent = '$' + originalEquilibrium.price.toFixed(2);
        document.getElementById('eqQuantityOriginal').textContent = originalEquilibrium.quantity.toFixed(2);
    } else {
        document.getElementById('eqPriceOriginal').textContent = '-';
        document.getElementById('eqQuantityOriginal').textContent = '-';
    }
    
    // Update current equilibrium display (only show after updating supply curve)
    if (showDemandCurve && showComparison && equilibrium) {
        document.getElementById('eqPrice').textContent = '$' + equilibrium.price.toFixed(2);
        document.getElementById('eqQuantity').textContent = equilibrium.quantity.toFixed(2);
    } else {
        document.getElementById('eqPrice').textContent = '-';
        document.getElementById('eqQuantity').textContent = '-';
    }
    
    // Update chart (pass original data if comparison is enabled)
    updateChart(supplyData, regions, showComparison ? originalSupplyData : null, originalRegions, demandIntercept, demandSlope, equilibrium, showComparison);
}

// Find equilibrium between supply and demand
function findEquilibrium(supplyData, demandIntercept, demandSlope) {
    // Demand: P = a - b*Q
    // Supply: step function from supplyData
    
    // Search for intersection
    for (let i = 0; i < supplyData.length - 1; i++) {
        const currentQ = supplyData[i].quantity;
        const currentP = supplyData[i].price;
        const nextQ = supplyData[i + 1].quantity;
        const nextP = supplyData[i + 1].price;
        
        const demandPriceCurrent = demandIntercept - demandSlope * currentQ;
        const demandPriceNext = demandIntercept - demandSlope * nextQ;
        
        // Case 1: Horizontal section (same price, quantity changes)
        if (currentP === nextP && currentQ !== nextQ) {
            // Check if demand curve crosses this horizontal supply step
            if (demandPriceCurrent >= currentP && demandPriceNext <= currentP) {
                // Find exact intersection: demandIntercept - demandSlope * Q = currentP
                const eqQuantity = (demandIntercept - currentP) / demandSlope;
                // Make sure equilibrium is within this segment
                if (eqQuantity >= currentQ && eqQuantity <= nextQ) {
                    return {
                        quantity: eqQuantity,
                        price: currentP
                    };
                }
            }
        }
        
        // Case 2: Vertical section (same quantity, price changes)
        if (currentQ === nextQ && currentP !== nextP) {
            // Check if demand curve crosses this vertical supply step
            if (demandPriceCurrent >= currentP && demandPriceCurrent <= nextP) {
                // Equilibrium is at this quantity with demand price
                return {
                    quantity: currentQ,
                    price: demandPriceCurrent
                };
            }
        }
        
        // Check if equilibrium is at the boundary
        if (i === 0 && demandPriceCurrent < currentP) {
            // Demand too low for any supply
            return null;
        }
    }
    
    // Check if demand is always above supply (quantity constrained)
    const maxQ = supplyData[supplyData.length - 1].quantity;
    const demandAtMax = demandIntercept - demandSlope * maxQ;
    const supplyAtMax = supplyData[supplyData.length - 1].price;
    
    if (demandAtMax >= supplyAtMax) {
        return {
            quantity: maxQ,
            price: demandAtMax
        };
    }
    
    return null;
}

// Store mouse position for tooltip filtering
let mouseY = null;

// Update the chart with new data
function updateChart(supplyData, regions, prevSupplyData, prevRegions, demandIntercept, demandSlope, equilibrium, showDemandComparison) {
    const ctx = document.getElementById('supplyCurveChart').getContext('2d');
    
    // Build datasets array
    const datasets = [];
    
    // Previous supply curve (if exists) - shown in red, offset slightly up
    if (prevSupplyData) {
        const prevStepData = prevSupplyData.map(point => ({
            x: point.quantity,
            y: point.price + 0.5  // Offset slightly upward for visibility
        }));
        
        datasets.push({
            label: 'Original Supply Curve',
            data: prevStepData,
            borderColor: 'rgba(239, 68, 68, 0.8)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 3,
            tension: 0,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: 'rgba(239, 68, 68, 1)',
        fill: false,
            order: 2
        });
    }
    
    // Current step function dataset
    const stepData = supplyData.map(point => ({
        x: point.quantity,
        y: point.price
    }));
    
    datasets.push({
        label: prevSupplyData ? 'Updated Supply Curve' : 'Supply Curve',
        data: stepData,
        borderColor: prevSupplyData ? 'rgba(59, 130, 246, 0.8)' : 'rgba(239, 68, 68, 0.8)',
        backgroundColor: prevSupplyData ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        borderWidth: 3,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: prevSupplyData ? 'rgba(59, 130, 246, 1)' : 'rgba(239, 68, 68, 1)',
        fill: false,
        order: 1,
        segment: {
            borderColor: ctx => {
                // Use the same color for all segments
                return prevSupplyData ? 'rgba(59, 130, 246, 0.8)' : 'rgba(239, 68, 68, 0.8)';
            }
        }
    });
    
    // Add demand curve if enabled
    const showDemand = document.getElementById('showDemand').checked;
    if (showDemand) {
        const maxQ = Math.max(...supplyData.map(d => d.quantity));
        
        // Add original demand curve if comparison is enabled and parameters have changed
        if (showDemandComparison && originalDemandIntercept !== null && 
            (originalDemandIntercept !== demandIntercept || originalDemandSlope !== demandSlope)) {
            const originalDemandData = [];
            for (let q = 0; q <= maxQ * 1.2; q += maxQ / 100) {
                const p = originalDemandIntercept - originalDemandSlope * q;
                if (p >= 0) {
                    originalDemandData.push({ x: q, y: p });
                }
            }
            
            datasets.push({
                label: 'Original Demand Curve',
                data: originalDemandData,
                borderColor: 'rgba(16, 185, 129, 0.6)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                borderDash: [5, 5],
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 0,
                pointHoverBorderWidth: 0,
                fill: false,
                order: 2,
                hoverRadius: 0,
                hoverBorderWidth: 0
            });
        }
        
        // Current demand curve
        const demandData = [];
        for (let q = 0; q <= maxQ * 1.2; q += maxQ / 100) {
            const p = demandIntercept - demandSlope * q;
            if (p >= 0) {
                demandData.push({ x: q, y: p });
            }
        }
        
        const isDemandChanged = showDemandComparison && originalDemandIntercept !== null && 
            (originalDemandIntercept !== demandIntercept || originalDemandSlope !== demandSlope);
        
        datasets.push({
            label: isDemandChanged ? 'Updated Demand Curve' : 'Demand Curve',
            data: demandData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 3,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHoverBorderWidth: 0,
            fill: false,
            order: 1,
            hoverRadius: 0,
            hoverBorderWidth: 0
        });
    }
    
    // Add equilibrium point
    if (equilibrium && showDemand) {
        datasets.push({
            label: 'Equilibrium',
            data: [{ x: equilibrium.quantity, y: equilibrium.price }],
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            pointRadius: 5,
            pointStyle: 'circle',
            showLine: false,
            order: 0
        });
    }
    
    // Destroy existing chart if it exists
    if (chart) {
        chart.destroy();
    }
    
    // Determine max values for axes
    const maxQuantity = Math.max(...supplyData.map(d => d.quantity));
    const maxPrice = Math.max(...supplyData.map(d => d.price));
    
    // Create new chart
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            onHover: (event, activeElements, chart) => {
                // Store mouse position and manually control hover state
                const canvasPosition = Chart.helpers.getRelativePosition(event, chart);
                const dataX = chart.scales.x.getValueForPixel(canvasPosition.x);
                mouseY = chart.scales.y.getValueForPixel(canvasPosition.y);
                
                const verticalThreshold = 10;
                
                // Find the nearest point on the supply curve at this x position
                let nearestPoint = null;
                let nearestIndex = -1;
                let minDistance = Infinity;
                
                supplyData.forEach((point, index) => {
                    if (point.region) { // Only consider horizontal sections with regions
                        const distance = Math.abs(point.quantity - dataX);
                        if (distance < minDistance) {
                            minDistance = distance;
                            nearestPoint = point;
                            nearestIndex = index;
                        }
                    }
                });
                
                // Check if mouse is within vertical threshold of the nearest point
                if (nearestPoint && mouseY !== null && Math.abs(mouseY - nearestPoint.price) <= verticalThreshold) {
                    // Show hover for this point
                    const datasetIndex = prevSupplyData ? 1 : 0; // Current supply curve dataset
                    chart.setActiveElements([{
                        datasetIndex: datasetIndex,
                        index: nearestIndex
                    }]);
                    chart.tooltip.setActiveElements([{
                        datasetIndex: datasetIndex,
                        index: nearestIndex
                    }]);
                } else {
                    // Clear all hover states
                    chart.setActiveElements([]);
                    chart.tooltip.setActiveElements([]);
                }
                
                chart.update('none');
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 15,
                        font: {
                            size: 11
                        },
                        filter: function(legendItem, chartData) {
                            // Hide equilibrium point from legend
                            return legendItem.text !== 'Equilibrium';
                        },
                        boxWidth: 40,
                        boxHeight: 3
                    }
                },
                title: {
                    display: true,
                    text: 'Global Oil Supply Curve',
                    font: {
                        size: 18,
                        weight: 'bold'
                    },
                    padding: 20
                },
                tooltip: {
                    enabled: true,
                    mode: 'nearest',
                    intersect: false,
                    filter: function(tooltipItem) {
                        // Only show tooltip for supply curves on horizontal sections with regions
                        const label = tooltipItem.dataset.label;
                        if (label === 'Demand Curve' || label === 'Equilibrium') {
                            return false;
                        }
                        
                        // Check if this point has a region (horizontal section only)
                        const dataIndex = tooltipItem.dataIndex;
                        if (dataIndex < supplyData.length && supplyData[dataIndex].region) {
                            // Check vertical distance threshold (in price/data units)
                            const verticalThreshold = 10; // Adjust this value to change sensitivity
                            const pointPrice = supplyData[dataIndex].price;
                            
                            // Only show if mouse is within vertical threshold of the line
                            if (mouseY !== null && Math.abs(mouseY - pointPrice) <= verticalThreshold) {
                                return true;
                            }
                        }
                        
                        return false; // Hide tooltip for vertical sections or if too far from line
                    },
                    callbacks: {
                        title: function(tooltipItems) {
                            if (tooltipItems && tooltipItems.length > 0) {
                                const item = tooltipItems[0];
                                const dataIndex = item.dataIndex;
                                
                                // Return the region name
                                if (dataIndex < supplyData.length && supplyData[dataIndex].region) {
                                    return supplyData[dataIndex].region;
                                }
                            }
                            return '';
                        },
                        label: function(context) {
                            // Return empty string to not show any label
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Cumulative Capacity (million barrels per day)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    min: 0,
                    max: maxQuantity * 1.05,
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(0) + ' mbpd';
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Marginal Cost ($/barrel)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    min: 0,
                    max: maxPrice * 1.1,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                }
            }
        }
    });
}

// Enable comparison mode
function enableComparison() {
    showComparison = true;
    calculate();
}

// Clear comparison history
function clearHistory() {
    showComparison = false;
    calculate();
}

// Reset to default values
function reset() {
    // Clear existing regions
    const container = document.getElementById('regionsContainer');
    container.innerHTML = '';
    regionCounter = 0;
    
    // Clear original data so it gets recalculated with default values
    originalSupplyData = null;
    originalRegions = null;
    originalEquilibrium = null;
    originalDemandIntercept = null;
    originalDemandSlope = null;
    showComparison = false;
    
    // Reset demand curve inputs to default values
    document.getElementById('demandIntercept').value = 120;
    document.getElementById('demandSlope').value = 0.6;
    
    // Add default regions
    defaultRegions.forEach(region => {
        addRegion(region);
    });
    
    // Calculate and display
    calculate();
}

