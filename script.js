// ============================================================
// Firebase init
// ============================================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

let currentUser = null;
let posts = [];              // live cache of all posts from Firestore
let unsubscribePosts = null;
let selectedPhotoFile = null;
let activeClaimPostId = null;

// ---------- filter state ----------
let activeTypeFilter = "all";   // all | lost | found | mine
let activeCategory = "all";
let searchTerm = "";
let showResolved = false;

// ============================================================
// Elements
// ============================================================
const loginScreen = document.getElementById("loginScreen");
const appRoot = document.getElementById("appRoot");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const loginError = document.getElementById("loginError");
const signOutBtn = document.getElementById("signOutBtn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");

const itemsGrid = document.getElementById("itemsGrid");
const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const showResolvedCheckbox = document.getElementById("showResolved");
const tabs = document.querySelectorAll(".tab");

const reportBtn = document.getElementById("reportBtn");
const closeFormBtn = document.getElementById("closeForm");
const overlay = document.getElementById("overlay");
const formPanel = document.getElementById("formPanel");
const itemForm = document.getElementById("itemForm");
const submitBtn = document.getElementById("submitBtn");
const toast = document.getElementById("toast");

const itemPhotoInput = document.getElementById("itemPhoto");
const photoPreview = document.getElementById("photoPreview");
const matchPanel = document.getElementById("matchPanel");
const matchHeading = document.getElementById("matchHeading");
const matchList = document.getElementById("matchList");

const claimOverlay = document.getElementById("claimOverlay");
const claimModal = document.getElementById("claimModal");
const closeClaimBtn = document.getElementById("closeClaim");
const claimItemTitle = document.getElementById("claimItemTitle");
const claimQuestionText = document.getElementById("claimQuestionText");
const claimAnswer = document.getElementById("claimAnswer");
const submitClaimBtn = document.getElementById("submitClaimBtn");

// ============================================================
// Auth
// ============================================================
googleLoginBtn.addEventListener("click", () => {
  loginError.hidden = true;
  const provider = new firebase.auth.GoogleAuthProvider();
  console.log("[debug] opening popup…");
  auth.signInWithPopup(provider)
    .then(result => {
      console.log("[debug] signInWithPopup resolved:", result);
    })
    .catch(err => {
      console.error("[debug] signInWithPopup error:", err);
      loginError.textContent = "Sign-in failed: " + err.message;
      loginError.hidden = false;
    });
});

signOutBtn.addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  console.log("[debug] onAuthStateChanged fired, user =", user);
  if (!user) {
    currentUser = null;
    loginScreen.hidden = false;
    appRoot.hidden = true;
    if (unsubscribePosts) unsubscribePosts();
    return;
  }

  const email = user.email || "";
  const domain = email.split("@")[1] || "";

  if (typeof ALLOWED_EMAIL_DOMAIN !== "undefined" && ALLOWED_EMAIL_DOMAIN && domain !== ALLOWED_EMAIL_DOMAIN) {
    loginError.textContent = `Please sign in with your @${ALLOWED_EMAIL_DOMAIN} college email.`;
    loginError.hidden = false;
    await auth.signOut();
    return;
  }

  currentUser = user;
  loginScreen.hidden = true;
  appRoot.hidden = false;

  userAvatar.src = user.photoURL || "";
  userName.textContent = user.displayName || user.email;

  // save/update a lightweight user profile
  db.collection("users").doc(user.uid).set({
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  listenToPosts();
});

// ============================================================
// Firestore: live posts listener
// ============================================================
function listenToPosts() {
  if (unsubscribePosts) unsubscribePosts();
  loadingState.hidden = false;

  unsubscribePosts = db.collection("posts")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loadingState.hidden = true;
      render();
    }, (err) => {
      loadingState.textContent = "Could not load posts: " + err.message;
    });
}

// ============================================================
// Helpers
// ============================================================
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function keywordsOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const wordsB = b.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return wordsB.some(w => wordsA.has(w));
}

// ============================================================
// Rendering: board
// ============================================================
function getFilteredPosts() {
  return posts
    .filter(p => {
      if (activeTypeFilter === "all") return true;
      if (activeTypeFilter === "mine") return p.ownerUid === currentUser.uid;
      return p.type === activeTypeFilter;
    })
    .filter(p => activeCategory === "all" || p.category === activeCategory)
    .filter(p => showResolved || p.status !== "resolved")
    .filter(p => {
      if (!searchTerm) return true;
      const haystack = `${p.title} ${p.description} ${p.location} ${p.category}`.toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
}

function render() {
  const filtered = getFilteredPosts();
  itemsGrid.innerHTML = "";

  if (filtered.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = posts.length === 0
      ? "Nothing pinned here yet. Be the first to report a lost or found item."
      : "No items match your filters.";
    return;
  }
  emptyState.hidden = true;

  filtered.forEach(post => {
    const card = document.createElement("article");
    card.className = "card" + (post.status === "resolved" ? " resolved" : "");
    card.dataset.id = post.id;

    const isOwner = currentUser && post.ownerUid === currentUser.uid;
    const isResolved = post.status === "resolved";

    let actionsHtml = "";
    if (isResolved) {
      actionsHtml = `<div class="resolved-note">✔ Returned / resolved</div>`;
    } else if (isOwner) {
      actionsHtml = `
        <div class="card-actions">
          <button class="resolve-btn" data-action="resolve">Mark as returned</button>
          <button class="delete-btn" data-action="delete">Remove</button>
        </div>
        <div class="claims-box" data-claims-for="${post.id}">
          <p class="claims-loading">Checking for claims…</p>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="card-actions">
          <button class="claim-btn" data-action="claim">Claim this item</button>
        </div>
      `;
    }

    card.innerHTML = `
      ${post.photoURL ? `<img class="card-photo" src="${post.photoURL}" alt="">` : ""}
      <div class="card-top">
        <span class="badge ${post.type}">${post.type}</span>
        <span class="badge category">${escapeHtml(post.category)}</span>
      </div>
      <h3>${escapeHtml(post.title)}</h3>
      ${post.description ? `<p>${escapeHtml(post.description)}</p>` : ""}
      <div class="meta-row">
        <span>📍 ${escapeHtml(post.location)}</span>
        <span>🗓 ${formatDate(post.date)}</span>
        <span>👤 ${escapeHtml(post.ownerName || "")}</span>
      </div>
      ${actionsHtml}
    `;

    itemsGrid.appendChild(card);

    if (isOwner && !isResolved) {
      loadClaimsForPost(post, card.querySelector(`[data-claims-for="${post.id}"]`));
    }
  });
}

// ============================================================
// Claims: owner side (list + accept/reject)
// ============================================================
function loadClaimsForPost(post, container) {
  db.collection("posts").doc(post.id).collection("claims")
    .where("status", "==", "pending")
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        container.innerHTML = "";
        return;
      }
      container.innerHTML = `<p class="claims-heading">${snapshot.size} pending claim(s):</p>`;
      snapshot.forEach(doc => {
        const claim = doc.data();
        const row = document.createElement("div");
        row.className = "claim-row";
        row.innerHTML = `
          <p class="claim-from"><strong>${escapeHtml(claim.claimantName)}</strong> answered:</p>
          <p class="claim-answer-text">"${escapeHtml(claim.answer)}"</p>
          <div class="claim-row-actions">
            <button class="accept-btn" data-claim-id="${doc.id}" data-post-id="${post.id}">Accept &amp; mark returned</button>
            <button class="reject-btn" data-claim-id="${doc.id}" data-post-id="${post.id}">Reject</button>
          </div>
        `;
        container.appendChild(row);
      });
    })
    .catch(() => { container.innerHTML = ""; });
}

itemsGrid.addEventListener("click", async (e) => {
  // accept / reject a claim
  const acceptBtn = e.target.closest(".accept-btn");
  const rejectBtn = e.target.closest(".reject-btn");
  if (acceptBtn || rejectBtn) {
    const btn = acceptBtn || rejectBtn;
    const postId = btn.dataset.postId;
    const claimId = btn.dataset.claimId;
    const claimRef = db.collection("posts").doc(postId).collection("claims").doc(claimId);

    if (acceptBtn) {
      await claimRef.update({ status: "accepted" });
      await db.collection("posts").doc(postId).update({ status: "resolved" });
      showToast("Item marked as returned.");
    } else {
      await claimRef.update({ status: "rejected" });
      showToast("Claim rejected.");
      const card = btn.closest(".card");
      loadClaimsForPost({ id: postId }, card.querySelector(`[data-claims-for="${postId}"]`));
    }
    return;
  }

  // owner actions
  const actionBtn = e.target.closest("button[data-action]");
  if (!actionBtn) return;
  const card = e.target.closest(".card");
  const postId = card.dataset.id;
  const post = posts.find(p => p.id === postId);
  if (!post) return;

  if (actionBtn.dataset.action === "resolve") {
    await db.collection("posts").doc(postId).update({ status: "resolved" });
    showToast("Marked as returned.");
  }

  if (actionBtn.dataset.action === "delete") {
    if (confirm(`Remove "${post.title}" from the board?`)) {
      await db.collection("posts").doc(postId).delete();
      showToast("Item removed.");
    }
  }

  if (actionBtn.dataset.action === "claim") {
    openClaimModal(post);
  }
});

// ============================================================
// Claim modal: claimant side
// ============================================================
function openClaimModal(post) {
  activeClaimPostId = post.id;
  claimItemTitle.textContent = post.title;
  claimQuestionText.textContent = post.claimQuestion || "(No question set by poster.)";
  claimAnswer.value = "";
  claimModal.classList.add("open");
  claimOverlay.classList.add("open");
  claimModal.setAttribute("aria-hidden", "false");
}

function closeClaimModal() {
  claimModal.classList.remove("open");
  claimOverlay.classList.remove("open");
  claimModal.setAttribute("aria-hidden", "true");
  activeClaimPostId = null;
}

closeClaimBtn.addEventListener("click", closeClaimModal);
claimOverlay.addEventListener("click", closeClaimModal);

submitClaimBtn.addEventListener("click", async () => {
  const answer = claimAnswer.value.trim();
  if (!answer) {
    showToast("Please answer the question.");
    return;
  }
  submitClaimBtn.disabled = true;
  try {
    await db.collection("posts").doc(activeClaimPostId).collection("claims").add({
      claimantUid: currentUser.uid,
      claimantName: currentUser.displayName || currentUser.email,
      claimantEmail: currentUser.email,
      answer,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast("Claim submitted — the poster will review it.");
    closeClaimModal();
  } catch (err) {
    showToast("Could not submit claim: " + err.message);
  }
  submitClaimBtn.disabled = false;
});

// ============================================================
// Tabs & filters
// ============================================================
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeTypeFilter = tab.dataset.filter;
    render();
  });
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  render();
});

categoryFilter.addEventListener("change", (e) => {
  activeCategory = e.target.value;
  render();
});

showResolvedCheckbox.addEventListener("change", (e) => {
  showResolved = e.target.checked;
  render();
});

// ============================================================
// Report form: open/close
// ============================================================
function openForm() {
  formPanel.classList.add("open");
  overlay.classList.add("open");
  formPanel.setAttribute("aria-hidden", "false");
  document.getElementById("itemDate").valueAsDate = new Date();
}

function closeForm() {
  formPanel.classList.remove("open");
  overlay.classList.remove("open");
  formPanel.setAttribute("aria-hidden", "true");
  itemForm.reset();
  selectedPhotoFile = null;
  photoPreview.hidden = true;
  matchPanel.hidden = true;
}

reportBtn.addEventListener("click", openForm);
closeFormBtn.addEventListener("click", closeForm);
overlay.addEventListener("click", closeForm);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (formPanel.classList.contains("open")) closeForm();
    if (claimModal.classList.contains("open")) closeClaimModal();
  }
});

// ---------- photo preview ----------
itemPhotoInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    photoPreview.src = ev.target.result;
    photoPreview.hidden = false;
  };
  reader.readAsDataURL(file);
});

// ---------- live "check existing posts" before submitting ----------
function updateMatchPanel() {
  const type = itemForm.querySelector('input[name="type"]:checked').value;
  const oppositeType = type === "lost" ? "found" : "lost";
  const title = document.getElementById("itemTitle").value.trim();
  const category = document.getElementById("itemCategory").value;

  if (!title) {
    matchPanel.hidden = true;
    return;
  }

  const candidates = posts.filter(p =>
    p.type === oppositeType &&
    p.status !== "resolved" &&
    (p.category === category || keywordsOverlap(p.title, title))
  ).slice(0, 4);

  if (candidates.length === 0) {
    matchPanel.hidden = true;
    return;
  }

  matchHeading.textContent = type === "lost"
    ? "Check these found items first — could be yours:"
    : "Check these lost reports first — someone may already be looking:";

  matchList.innerHTML = candidates.map(p => `
    <div class="match-item">
      <strong>${escapeHtml(p.title)}</strong>
      <span>${escapeHtml(p.location)} · ${formatDate(p.date)}</span>
    </div>
  `).join("");

  matchPanel.hidden = false;
}

document.getElementById("itemTitle").addEventListener("input", updateMatchPanel);
document.getElementById("itemCategory").addEventListener("change", updateMatchPanel);
itemForm.querySelectorAll('input[name="type"]').forEach(r => r.addEventListener("change", updateMatchPanel));

// ============================================================
// Report form: submit
// ============================================================
itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const type = itemForm.querySelector('input[name="type"]:checked').value;
  const title = document.getElementById("itemTitle").value.trim();
  const category = document.getElementById("itemCategory").value;
  const description = document.getElementById("itemDesc").value.trim();
  const location = document.getElementById("itemLocation").value.trim();
  const date = document.getElementById("itemDate").value;
  const claimQuestion = document.getElementById("itemQuestion").value.trim();

  if (!title || !location || !date || !claimQuestion) {
    showToast("Please fill in all required fields.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Pinning…";

  try {
    let photoURL = "";
    if (selectedPhotoFile) {
      const path = `posts/${currentUser.uid}/${Date.now()}_${selectedPhotoFile.name}`;
      const ref = storage.ref(path);
      await ref.put(selectedPhotoFile);
      photoURL = await ref.getDownloadURL();
    }

    await db.collection("posts").add({
      type,
      title,
      category,
      description,
      location,
      date,
      photoURL,
      claimQuestion,
      status: "open",
      ownerUid: currentUser.uid,
      ownerName: currentUser.displayName || currentUser.email,
      ownerEmail: currentUser.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    closeForm();
    showToast(type === "lost" ? "Lost item posted to the board." : "Found item posted to the board.");
  } catch (err) {
    showToast("Could not post item: " + err.message);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Pin it to the board";
});