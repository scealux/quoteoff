// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    updateDoc,
    query,
    where,
    limit,
    orderBy,
    increment
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- CONFIGURATION ---
// TODO: Replace with your actual Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyCmX4oZZS4bZggeGfIKeQKszxTJO6sIV4Q",
    authDomain: "quoteoff2025.firebaseapp.com",
    projectId: "quoteoff2025",
    storageBucket: "quoteoff2025.firebasestorage.app",
    messagingSenderId: "668304180088",
    appId: "1:668304180088:web:2fb50797af983b756c7e8d",
    measurementId: "G-K0XJ0J126S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- STATE ---
let currentPair = {
    left: null,
    right: null
};

// --- DOM ELEMENTS ---
const tabs = {
    vote: document.getElementById('nav-vote'),
    leaderboard: document.getElementById('nav-leaderboard'),
    about: document.getElementById('nav-about')
};

const sections = {
    vote: document.getElementById('tab-vote'),
    leaderboard: document.getElementById('tab-leaderboard'),
    about: document.getElementById('tab-about')
};

const votingArea = {
    container: document.getElementById('voting-area'),
    loading: document.getElementById('loading-message'),
    leftCard: document.getElementById('card-left'),
    rightCard: document.getElementById('card-right'),
    leftText: document.querySelector('#card-left .quote-text'),
    rightText: document.querySelector('#card-right .quote-text')
};

const leaderboardArea = {
    list: document.getElementById('leaderboard-list'),
    loading: document.getElementById('leaderboard-loading')
};

// --- NAVIGATION ---
function switchTab(tabName) {
    // Update Nav Buttons
    Object.values(tabs).forEach(btn => btn.classList.remove('active'));
    tabs[tabName].classList.add('active');

    // Update Sections
    Object.values(sections).forEach(sec => sec.classList.remove('active', 'hidden'));
    Object.values(sections).forEach(sec => sec.style.display = 'none'); // Hard reset display

    sections[tabName].style.display = 'block';
    sections[tabName].classList.add('active');

    if (tabName === 'leaderboard') {
        loadLeaderboard();
    }
}

tabs.vote.addEventListener('click', () => switchTab('vote'));
tabs.leaderboard.addEventListener('click', () => switchTab('leaderboard'));
tabs.about.addEventListener('click', () => switchTab('about'));

// --- VOTING LOGIC ---

/**
 * Fetch a random quote.
 * Uses a random integer ID strategy assuming approx 250 quotes.
 * Logic: Generate random ID (1-250), query where 'id' == randomID.
 * If conflict/missing, retry (simple recursion).
 */
async function fetchRandomQuote(excludeId = null) {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        // Assume IDs are approx 1 to 300 based on upload count (275).
        // You might want to store a metadata doc with total count if strict accuracy is needed.
        const randomId = Math.floor(Math.random() * 300) + 1;

        if (excludeId && randomId === excludeId) continue;

        const q = query(
            collection(db, "quotes"),
            where("id", "==", randomId),
            limit(1)
        );

        try {
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                return { ...docSnap.data(), id: docSnap.id };
            }
        } catch (error) {
            console.error("Error fetching quote:", error);
        }
        retries++;
    }

    // Fallback if ID lookup fails repeatedly (e.g. gaps in IDs)
    // In production, better to use a dedicated 'random' field query or array of IDs.
    // For now, returning a placeholder or simplified fallback is safer than infinite loop.
    return null;
}

/**
 * Loads a new pair of quotes into the state and DOM
 */
async function loadNewPair() {
    // Show loading state if it's the first load
    if (!currentPair.left) {
        votingArea.loading.classList.remove('hidden');
        votingArea.container.classList.add('hidden');
    }

    // Reset card styles
    votingArea.leftCard.className = 'card';
    votingArea.rightCard.className = 'card';

    try {
        const [leftQuote, rightQuote] = await Promise.all([
            fetchRandomQuote(),
            fetchRandomQuote() // Note: slight chance of duplicate, handled below
        ]);

        // Simple duplicate check retry
        if (!leftQuote || !rightQuote || leftQuote.id === rightQuote.id) {
            // Recurse once to try again if we got unlucky
            console.log("Collision or fetch error, retrying pair...");
            return loadNewPair();
        }

        currentPair.left = leftQuote;
        currentPair.right = rightQuote;

        // Render safely
        votingArea.leftText.textContent = leftQuote.displayText;
        votingArea.rightText.textContent = rightQuote.displayText;

        votingArea.loading.classList.add('hidden');
        votingArea.container.classList.remove('hidden');

    } catch (e) {
        console.error("Failed to load pair", e);
        votingArea.loading.textContent = "Error loading quotes. Please refresh.";
    }
}

/**
 * Elo Calculation
 * K-factor = 32
 */
function calculateElo(winnerRating, loserRating) {
    const K = 32;
    // Expected score for winner: 1 / (1 + 10^((Rb - Ra) / 400))
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = Math.round(winnerRating + K * (1 - expectedWinner));
    const newLoserRating = Math.round(loserRating + K * (0 - expectedLoser));

    return { newWinnerRating, newLoserRating };
}

async function handleVote(winnerSide) {
    const winner = currentPair[winnerSide];
    const loserSide = winnerSide === 'left' ? 'right' : 'left';
    const loser = currentPair[loserSide];

    // Visual Feedback
    const winnerCard = winnerSide === 'left' ? votingArea.leftCard : votingArea.rightCard;
    const loserCard = loserSide === 'left' ? votingArea.leftCard : votingArea.rightCard;

    winnerCard.classList.add('winner');
    loserCard.classList.add('loser');

    // Opt for optimistic UI update or wait for DB? 
    // Wait for DB ensures consistency, but slightly slower feel. 
    // Given requirements, let's process logic then reload.

    const { newWinnerRating, newLoserRating } = calculateElo(winner.rating || 1000, loser.rating || 1000);

    try {
        const winnerRef = doc(db, "quotes", winner.id); // 'id' from doc snapshot logic usually is document ID string, make sure fetchRandomQuote returns doc key as id
        const loserRef = doc(db, "quotes", loser.id);

        await Promise.all([
            updateDoc(winnerRef, {
                rating: newWinnerRating,
                voteCount: increment(1)
            }),
            updateDoc(loserRef, {
                rating: newLoserRating
            })
        ]);

        // Delay slightly so user sees the result, then reload
        setTimeout(() => {
            loadNewPair();
        }, 800);

    } catch (error) {
        console.error("Error updating ratings:", error);
        alert("Vote failed to record. Please try again.");
        loadNewPair();
    }
}

// Event Listeners for Voting
votingArea.leftCard.addEventListener('click', () => handleVote('left'));
votingArea.rightCard.addEventListener('click', () => handleVote('right'));


// --- LEADERBOARD LOGIC ---
const leaderboardCache = {
    data: null,
    timestamp: 0,
    TTL: 60000 // 60 seconds
};

async function loadLeaderboard() {
    leaderboardArea.loading.style.display = 'block';
    leaderboardArea.list.innerHTML = '';

    // Check cache
    const now = Date.now();
    if (leaderboardCache.data && (now - leaderboardCache.timestamp < leaderboardCache.TTL)) {
        console.log("Using cached leaderboard");
        renderLeaderboard(leaderboardCache.data);
        leaderboardArea.loading.style.display = 'none';
        return;
    }

    console.log("Fetching leaderboard from Firestore...");
    const q = query(
        collection(db, "quotes"),
        orderBy("rating", "desc"),
        limit(10)
    );

    try {
        const querySnapshot = await getDocs(q);
        const data = [];
        querySnapshot.forEach((doc) => {
            data.push(doc.data());
        });

        // Update cache
        leaderboardCache.data = data;
        leaderboardCache.timestamp = now;

        renderLeaderboard(data);
        leaderboardArea.loading.style.display = 'none';

    } catch (error) {
        console.error("Leaderboard error:", error);
        leaderboardArea.loading.textContent = "Error loading leaderboard.";
    }
}

function renderLeaderboard(data) {
    leaderboardArea.list.innerHTML = '';
    data.forEach(item => {
        const li = document.createElement('li');

        // Safe rendering of text
        const textSpan = document.createElement('span');
        textSpan.textContent = item.displayText;

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'leaderboard-rating';
        scoreSpan.textContent = `(${item.rating || 1000})`;

        li.appendChild(textSpan);
        li.appendChild(scoreSpan);
        leaderboardArea.list.appendChild(li);
    });
}

// --- INIT ---
loadNewPair();
