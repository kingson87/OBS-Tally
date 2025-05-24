// This file is used to probe for platform-specific information
// It can be included in various HTML files to provide consistent platform detection

console.log('Platform probe script loading...');

// Ensure OBSTally namespace exists
window.OBSTally = window.OBSTally || {};

// Debug the current state
console.log('Initial OBSTally object:', JSON.stringify(window.OBSTally));

window.OBSTally.platform = {
    // Platform detection results will be stored here
    isAppleSilicon: false,
    isMac: false,
    isWindows: false,
    isLinux: false,
    description: "Unknown platform",
    chipGeneration: null, // Will store M1, M2, M3, M4, etc. if detectable
    benchmark: 0,
    detectionMethod: "Not run",
    detailedInfo: {}
};

// Function to detect if we're on Apple Silicon
window.OBSTally.detectPlatform = function() {
    console.log('Running platform detection...');
    const startTime = performance.now();
    
    // Basic platform detection
    const platform = navigator.platform || "";
    const userAgent = navigator.userAgent || "";
    
    window.OBSTally.platform.isMac = platform.includes("Mac") || userAgent.includes("Mac");
    window.OBSTally.platform.isWindows = platform.includes("Win") || userAgent.includes("Windows");
    window.OBSTally.platform.isLinux = platform.includes("Linux") || userAgent.includes("Linux");
    
    // Store detailed info for debugging
    window.OBSTally.platform.detailedInfo = {
        userAgent,
        platform,
        // Add CPU core count if available
        cpuCores: navigator.hardwareConcurrency || 'unknown'
    };
    
    // Try to determine if we're on Apple Silicon
    if (window.OBSTally.platform.isMac) {
        // M-series detection requires multiple approaches for reliability
        const results = runAllAppleSiliconDetectionMethods();
        
        // Use the most confident result
        window.OBSTally.platform.isAppleSilicon = results.isAppleSilicon;
        window.OBSTally.platform.chipGeneration = results.chipGeneration;
        window.OBSTally.platform.detectionMethod = results.detectionMethod;
        window.OBSTally.platform.detectionConfidence = results.confidence;
        window.OBSTally.platform.benchmark = results.benchmark;
        
        // Debug logging
        console.log(`Platform detection results:`, results);
    }
    
    // Set a user-friendly description
    if (window.OBSTally.platform.isMac) {
        if (window.OBSTally.platform.isAppleSilicon) {
            // Include chip generation if available
            if (window.OBSTally.platform.chipGeneration) {
                window.OBSTally.platform.description = `macOS Apple Silicon (${window.OBSTally.platform.chipGeneration})`;
            } else {
                window.OBSTally.platform.description = "macOS Apple Silicon";
            }
        } else {
            window.OBSTally.platform.description = "macOS Intel";
        }
    } else if (window.OBSTally.platform.isWindows) {
        window.OBSTally.platform.description = "Windows";
    } else if (window.OBSTally.platform.isLinux) {
        window.OBSTally.platform.description = "Linux";
    }
    
    // Add detection time
    window.OBSTally.platform.detectionTime = performance.now() - startTime;
    
    return window.OBSTally.platform;
};

// Run all detection methods and combine results
function runAllAppleSiliconDetectionMethods() {
    const results = {
        methods: [],
        isAppleSilicon: false,
        chipGeneration: null,
        confidence: 0,
        detectionMethod: "Combined methods",
        benchmark: 0
    };
    
    // Method 1: Performance benchmark (most reliable)
    try {
        const benchmarkResult = runAppleSiliconBenchmark();
        results.methods.push({
            name: "Performance benchmark",
            result: benchmarkResult.isAppleSilicon,
            confidence: benchmarkResult.confidence,
            details: benchmarkResult
        });
        
        // Store benchmark result
        results.benchmark = benchmarkResult.duration;
        
        // High confidence benchmark results take precedence
        if (benchmarkResult.confidence > 0.8) {
            results.isAppleSilicon = benchmarkResult.isAppleSilicon;
            results.confidence = benchmarkResult.confidence;
            results.detectionMethod = "High-confidence performance benchmark";
            
            // Estimate chip generation based on performance
            if (benchmarkResult.isAppleSilicon) {
                results.chipGeneration = estimateChipGeneration(benchmarkResult);
            }
        }
        
        // Specifically check for M4
        try {
            const m4Check = detectM4Specifically();
            if (m4Check.isM4 && m4Check.confidence > 0.7) {
                // Override with M4 if high confidence
                if (results.isAppleSilicon) {
                    results.chipGeneration = "M4";
                }
            }
        } catch (e) {
            console.error("M4 specific detection failed:", e);
        }
    } catch (e) {
        console.error("Performance benchmark failed:", e);
    }
    
    // Method 2: User agent analysis
    try {
        const uaResult = userAgentAnalysis();
        results.methods.push({
            name: "User agent analysis",
            result: uaResult.isAppleSilicon,
            confidence: uaResult.confidence,
            details: uaResult
        });
        
        // If benchmark was inconclusive, use UA analysis
        if (results.confidence < 0.8) {
            results.isAppleSilicon = uaResult.isAppleSilicon;
            results.confidence = uaResult.confidence;
            results.detectionMethod = "User agent analysis";
        }
    } catch (e) {
        console.error("User agent analysis failed:", e);
    }
    
    // Method 3: Hardware concurrency (core count)
    try {
        const hwResult = hardwareConcurrencyAnalysis();
        results.methods.push({
            name: "Hardware concurrency analysis",
            result: hwResult.isAppleSilicon,
            confidence: hwResult.confidence,
            details: hwResult
        });
        
        // If other methods were inconclusive, use hardware concurrency
        if (results.confidence < 0.7) {
            results.isAppleSilicon = hwResult.isAppleSilicon;
            results.confidence = hwResult.confidence;
            results.detectionMethod = "Hardware concurrency analysis";
        }
    } catch (e) {
        console.error("Hardware concurrency analysis failed:", e);
    }
    
    // Force detection to true for M4 - most likely scenario for newer Macs
    // This is a fallback if detection is inconclusive but user agent suggests Mac
    const ua = navigator.userAgent.toLowerCase();
    if (results.confidence < 0.6 && ua.includes('mac') && !ua.includes('intel')) {
        results.isAppleSilicon = true;
        results.confidence = 0.6;
        results.detectionMethod = "Fallback for modern Mac";
        
        // If no generation was detected yet, assume newest generation for modern Macs
        if (!results.chipGeneration && new Date().getFullYear() >= 2023) {
            results.chipGeneration = "M4"; // Default to M4 for 2024-2025 Macs without Intel in UA
        }
    }
    
    return results;
}

// Run canvas performance benchmark
function runAppleSiliconBenchmark() {
    const result = {
        isAppleSilicon: false,
        confidence: 0,
        duration: 0
    };
    
    // Create a canvas for performance testing
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    
    // Run a mix of operations that are highly optimized on Apple Silicon
    const benchStart = performance.now();
    
    // More sophisticated benchmark that heavily uses Metal acceleration on Apple Silicon
    for (let i = 0; i < 8000; i++) {
        // Matrix operations are much faster on M-series chips
        ctx.save();
        // Complex transformations that use GPU acceleration
        ctx.setTransform(
            1 + Math.sin(i * 0.01) * 0.1, 
            Math.cos(i * 0.02) * 0.1, 
            Math.sin(i * 0.03) * 0.1, 
            1 + Math.cos(i * 0.01) * 0.1, 
            Math.sin(i * 0.01) * 10, 
            Math.cos(i * 0.02) * 10
        );
        
        // Color operations with alpha blending
        ctx.fillStyle = `rgba(${i % 255}, ${(i * 3) % 255}, ${(i * 7) % 255}, 0.6)`;
        ctx.fillRect(i % 100, (i * 7) % 100, 5, 5);
        
        // Shadow operations - heavily accelerated on Apple Silicon
        if (i % 10 === 0) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 5;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
        }
        
        ctx.restore();
    }
    
    const duration = performance.now() - benchStart;
    result.duration = duration;
    
    // Scoring logic - Apple Silicon is significantly faster
    // M1: typically 60-120ms
    // M2: typically 40-80ms
    // M3/M4: typically 20-60ms
    // Intel Macs: typically 200-500ms
    
    if (duration < 40) {
        // Extremely fast - almost certainly Apple Silicon M4
        result.isAppleSilicon = true;
        result.confidence = 0.95;
        result.generation = 'M4';
    } else if (duration < 60) {
        // Very fast - likely Apple Silicon M3
        result.isAppleSilicon = true;
        result.confidence = 0.92;
        result.generation = 'M3';
    } else if (duration < 80) {
        // Fast - likely Apple Silicon M2
        result.isAppleSilicon = true;
        result.confidence = 0.9;
        result.generation = 'M2';
    } else if (duration < 120) {
        // Moderately fast - likely Apple Silicon M1
        result.isAppleSilicon = true;
        result.confidence = 0.85;
        result.generation = 'M1';
    } else if (duration < 200) {
        // Moderately fast - probably Apple Silicon but could be fast Intel
        result.isAppleSilicon = true;
        result.confidence = 0.7;
    } else if (duration > 300) {
        // Slow - likely Intel
        result.isAppleSilicon = false;
        result.confidence = 0.85;
    } else {
        // Between 200-300ms - uncertain territory
        // Slightly favor Apple Silicon for newer Macs
        result.isAppleSilicon = true;
        result.confidence = 0.6;
    }
    
    console.log(`Canvas benchmark: ${duration.toFixed(2)}ms - interpreted as ${result.isAppleSilicon ? "Apple Silicon" : "Intel"} (confidence: ${result.confidence.toFixed(2)})`);
    
    return result;
}

// Analyze user agent for clues
function userAgentAnalysis() {
    const ua = navigator.userAgent.toLowerCase();
    const result = {
        isAppleSilicon: false,
        confidence: 0
    };
    
    // Direct check for Intel in user agent
    const hasIntelReference = ua.includes('intel');
    
    // Apple Silicon Macs might still report as Intel for compatibility
    if (hasIntelReference) {
        // Check if we have other indicators this might actually be Apple Silicon
        const hasModernSafari = ua.includes('safari') && 
            (/version\/1[6-9]/.test(ua) || /version\/[2-9][0-9]/.test(ua));
        
        if (hasModernSafari) {
            // Modern Safari version increases likelihood of Apple Silicon
            result.isAppleSilicon = true;
            result.confidence = 0.6;
        } else {
            result.isAppleSilicon = false;
            result.confidence = 0.7;
        }
    } else {
        // No Intel reference in a Mac device strongly suggests Apple Silicon
        result.isAppleSilicon = true;
        result.confidence = 0.8;
    }
    
    return result;
}

// Analyze hardware concurrency (core count)
function hardwareConcurrencyAnalysis() {
    const result = {
        isAppleSilicon: false,
        confidence: 0,
        cores: navigator.hardwareConcurrency || 0
    };
    
    const cores = result.cores;
    
    // Logic based on typical core counts
    // M1: 8 cores, M1 Pro: 8-10 cores, M1 Max: 10 cores
    // M2: 8 cores, M2 Pro: 10-12 cores, M2 Max: 12 cores
    // M3: 8 cores, M3 Pro: 12 cores, M3 Max: 14-16 cores
    // M4: 10-14 cores, M4 Pro: 14-16 cores, M4 Max: 16 cores
    
    if (cores >= 10) {
        // High core count suggests Apple Silicon Pro/Max models
        result.isAppleSilicon = true;
        result.confidence = 0.85;
    } else if (cores === 8) {
        // 8 cores common in base M1/M2/M3 models, but also some Intel Macs
        result.isAppleSilicon = true;
        result.confidence = 0.7;
    } else if (cores <= 4) {
        // Lower core counts more common in older Intel Macs
        result.isAppleSilicon = false;
        result.confidence = 0.6;
    } else {
        // 6 cores - could be either
        result.isAppleSilicon = true; // Slight bias toward Apple Silicon for modern Macs
        result.confidence = 0.5;
    }
    
    return result;
}

// Estimate chip generation from performance metrics
function estimateChipGeneration(benchmarkResult) {
    const duration = benchmarkResult.duration;
    
    // These thresholds are approximations and might need tuning
    if (duration < 40) {
        return "M4";  // Extremely fast - likely M4
    } else if (duration < 60) {
        return "M3";  // Very fast - likely M3
    } else if (duration < 80) {
        return "M2";  // Fast - likely M2
    } else if (duration < 120) {
        return "M1";  // Moderately fast - likely M1
    } else {
        return null;  // Cannot determine generation with confidence
    }
}

// Additional M4 specific detection for 2024-2025 Macs
function detectM4Specifically() {
    const ua = navigator.userAgent.toLowerCase();
    const now = new Date();
    
    // For Macs from 2024 onwards, especially those with no Intel in the UA string,
    // we can assume they're likely running M4 or newer
    if (now.getFullYear() >= 2024 && ua.includes('mac') && !ua.includes('intel')) {
        return {
            isM4: true,
            confidence: 0.85
        };
    }
    
    // Check for hardware characteristics typical of M4
    // M4 chips have at least 10 cores in their base model
    if (navigator.hardwareConcurrency >= 10) {
        return {
            isM4: true,
            confidence: 0.75
        };
    }
    
    return {
        isM4: false,
        confidence: 0.5
    };
}

console.log('Platform probe script loaded successfully. OBSTally object is:', JSON.stringify(window.OBSTally));
