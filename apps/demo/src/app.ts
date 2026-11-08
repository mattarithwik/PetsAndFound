(() => {
  type Target = "agent" | "db" | "vision";
  type Endpoint = {
    group: string;
    name: string;
    target: Target;
    method: string;
    path: string;
    body?: unknown;
  };
  type AgentResult = {
    runId: string;
    status: string;
    summary: string;
    pendingAction?: unknown;
    actions?: unknown[];
  };
  type Photo = { id: string; storageKey: string; animalCount?: number };
  type Pet = { id: string; name: string; species: string };
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = (id: string) => element<HTMLInputElement>(id);
  const select = (id: string) => element<HTMLSelectElement>(id);
  const text = (id: string) => element<HTMLTextAreaElement>(id);
  const status = (id: string, value: string) => {
    element(id).textContent = value;
  };
  const authStage = element<HTMLDivElement>("auth-stage");
  const authTrack = element<HTMLDivElement>("auth-track");
  const authNext = element<HTMLButtonElement>("auth-next");
  const roleButtons = document.querySelectorAll<HTMLButtonElement>(".role-button");
  const mobileApp = element<HTMLDivElement>("mobile-app");
  const appPhoneFrame = element<HTMLDivElement>("app-phone-frame");
  const token = () => input("token").value.trim();
  input("token").value = sessionStorage.getItem("pawsafe-demo-token") || "";
  let database = "pawsafe";
  let previousRunId: string | undefined;
  let uploadedPhoto: Photo | undefined;
  let pendingPet: { id: string; name: string; species: string } | undefined;
  let lastAttempt: { fingerprint: string; payload: object } | undefined;

  roleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      roleButtons.forEach((roleButton) => roleButton.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });
  });

  authNext.addEventListener("click", () => {
    const selectedRole = document.querySelector<HTMLButtonElement>(".role-button.is-selected");
    if (!selectedRole) {
      roleButtons[0]?.focus();
      return;
    }
    authStage.hidden = true;
    appPhoneFrame.hidden = false;
    document.title = `PawSafe · ${selectedRole.dataset.role}`;
  });

  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.nav;
      document.querySelectorAll<HTMLElement>(".mobile-view").forEach((view) => {
        view.hidden = view.dataset.view !== target;
      });
    });
  });

  async function request(target: Target, path: string, method = "GET", body?: unknown, secret?: string) {
    const headers: Record<string, string> = {};
    const credential = target === "vision" ? secret : token();
    if (credential) headers.Authorization = "Bearer " + credential;
    if (body !== undefined)
      headers["Content-Type"] = path.endsWith("/sql") ? "text/plain" : "application/json";
    const response = await fetch(`/proxy/${target}${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === "string" && path.endsWith("/sql")
            ? body
            : JSON.stringify(body),
    });
    const raw = await response.text();
    let result: unknown = raw;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      /* Some database errors are plain text. */
    }
    if (!response.ok) {
      const error = result as { error?: string; detail?: string };
      throw new Error(
        typeof error?.error === "string"
          ? error.error
          : typeof error?.detail === "string"
            ? error.detail
            : raw || `HTTP ${response.status}`,
      );
    }
    return result;
  }
  const dbPath = (name: string) => `/v1/database/${encodeURIComponent(database)}/call/${name}`;
  const reducer = (name: string, body: object) => request("db", dbPath(name), "POST", [JSON.stringify(body)]);
  async function read<T>(resource: string, key = ""): Promise<T> {
    const result = await request("db", dbPath("api_read"), "POST", [resource, key]);
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  }
  async function run(buttonId: string, statusId: string, action: () => Promise<void>) {
    const button = element<HTMLButtonElement>(buttonId);
    button.disabled = true;
    status(statusId, "Working…");
    try {
      await action();
    } catch (error) {
      status(statusId, error instanceof Error ? error.message : "Request failed.");
    } finally {
      button.disabled = false;
    }
  }
  async function loadPets() {
    const pets = await read<Pet[]>("pets");
    const list = element<HTMLUListElement>("pets");
    const picker = select("photo-pet");
    list.replaceChildren();
    picker.replaceChildren(new Option("Select a pet", ""));
    for (const pet of pets) {
      const li = document.createElement("li");
      li.textContent = `${pet.name} · ${pet.species} · ${pet.id}`;
      list.append(li);
      picker.add(new Option(pet.name, pet.id));
    }
    status("session-status", pets.length ? `${pets.length} pet(s) loaded.` : "No pets yet.");
  }
  element("identity").addEventListener("click", () =>
    run("identity", "session-status", async () => {
      const identity = (await request("db", "/v1/identity", "POST")) as { identity: string; token: string };
      input("token").value = identity.token;
      sessionStorage.setItem("pawsafe-demo-token", identity.token);
      previousRunId = undefined;
      uploadedPhoto = undefined;
      lastAttempt = undefined;
      messages.replaceChildren();
      element("pets").replaceChildren();
      select("photo-pet").replaceChildren(new Option("Select a pet", ""));
      status(
        "session-status",
        `Identity created: ${identity.identity.slice(0, 12)}… Save your profile next.`,
      );
    }),
  );
  input("token").addEventListener("change", () => {
    if (token()) sessionStorage.setItem("pawsafe-demo-token", token());
    else sessionStorage.removeItem("pawsafe-demo-token");
    previousRunId = undefined;
    uploadedPhoto = undefined;
    lastAttempt = undefined;
    element("pets").replaceChildren();
    select("photo-pet").replaceChildren(new Option("Select a pet", ""));
    status("session-status", "Token changed. Save your profile or refresh your pets.");
  });
  element("profile").addEventListener("click", () =>
    run("profile", "session-status", async () => {
      const name = input("name").value.trim();
      if (!token() || !name) throw new Error("Enter a token and your name.");
      await reducer("register_user", { name, generalLocation: input("city").value.trim() });
      status("session-status", "Profile saved.");
    }),
  );
  for (const id of ["pet-name", "species"])
    element(id).addEventListener("input", () => {
      pendingPet = undefined;
    });
  element("add-pet").addEventListener("click", () =>
    run("add-pet", "session-status", async () => {
      const name = input("pet-name").value.trim();
      if (!token() || !name) throw new Error("Enter a token and pet name.");
      pendingPet ||= { id: crypto.randomUUID(), name, species: select("species").value };
      await reducer("register_pet", pendingPet);
      pendingPet = undefined;
      input("pet-name").value = "";
      await loadPets();
    }),
  );
  element("load-pets").addEventListener("click", () => run("load-pets", "session-status", loadPets));
  input("photo").addEventListener("change", () => {
    uploadedPhoto = undefined;
    status("photo-status", "");
  });
  input("one-animal").addEventListener("change", () => {
    if (!uploadedPhoto) return;
    if (input("one-animal").checked) uploadedPhoto.animalCount = 1;
    else delete uploadedPhoto.animalCount;
  });
  element("upload").addEventListener("click", () =>
    run("upload", "photo-status", async () => {
      const file = input("photo").files?.[0];
      if (!file) throw new Error("Choose a photo first.");
      const signed = (await request("agent", "/v1/uploads/sign", "POST", {})) as {
        photoId: string;
        storageKey: string;
        uploadUrl: string;
        fields: Record<string, string>;
      };
      const data = new FormData();
      for (const [name, value] of Object.entries(signed.fields)) data.append(name, value);
      data.append("file", file);
      const response = await fetch(signed.uploadUrl, { method: "POST", body: data });
      if (!response.ok) throw new Error("Photo upload failed (" + response.status + ").");
      uploadedPhoto = {
        id: signed.photoId,
        storageKey: signed.storageKey,
        ...(input("one-animal").checked ? { animalCount: 1 } : {}),
      };
      status("photo-status", `Uploaded ${uploadedPhoto.id}. Available to the next agent message.`);
    }),
  );
  element("attach").addEventListener("click", () =>
    run("attach", "photo-status", async () => {
      const petId = select("photo-pet").value;
      if (!uploadedPhoto || !petId) throw new Error("Upload a photo and select a pet.");
      await reducer("attach_pet_photo", { ...uploadedPhoto, petId, angle: "front" });
      status("photo-status", "Photo attached. The worker will create its embedding.");
      uploadedPhoto = undefined;
    }),
  );

  const messages = element("messages");
  function message(role: string, content: string) {
    messages.querySelector(".empty")?.remove();
    const item = document.createElement("div");
    item.className = "message " + role.toLowerCase();
    const heading = document.createElement("strong");
    heading.textContent = role;
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    item.append(heading, paragraph);
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  }
  function showResult(result: AgentResult) {
    previousRunId = result.runId;
    const item = message("Agent", result.summary || result.status);
    if (result.actions?.length) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Tool results";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(result.actions, null, 2);
      details.append(summary, pre);
      item.append(details);
    }
    if (result.pendingAction) {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(result.pendingAction, null, 2);
      const button = document.createElement("button");
      button.textContent = "Confirm report";
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const confirmed = (await request("agent", "/v1/agent/confirm-action", "POST", {
            runId: result.runId,
            confirmed: true,
          })) as AgentResult;
          uploadedPhoto = undefined;
          showResult(confirmed);
          button.remove();
        } catch (error) {
          status("chat-status", error instanceof Error ? error.message : "Confirmation failed.");
          button.disabled = false;
        }
      });
      item.append(pre, button);
    }
    messages.scrollTop = messages.scrollHeight;
  }
  function context() {
    const city = input("city").value.trim();
    const latitude = input("latitude").value;
    const longitude = input("longitude").value;
    if (!!latitude !== !!longitude) throw new Error("Enter both latitude and longitude.");
    const reportId = input("report-id").value.trim();
    return {
      ...(city ? { city } : {}),
      ...(latitude && longitude
        ? { location: { latitude: Number(latitude), longitude: Number(longitude) } }
        : {}),
      ...(reportId ? { reportId } : {}),
      ...(uploadedPhoto ? { photos: [uploadedPhoto] } : {}),
    };
  }
  element("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run("send", "chat-status", async () => {
      const content = text("message").value.trim();
      if (!token() || !content) throw new Error("Enter a token and a message.");
      const sessionToken = token();
      const state = { message: content, context: context(), ...(previousRunId ? { previousRunId } : {}) };
      const fingerprint = JSON.stringify(state);
      if (lastAttempt?.fingerprint !== fingerprint) {
        lastAttempt = { fingerprint, payload: { requestId: crypto.randomUUID(), ...state } };
        message("You", content);
      }
      const result = (await request(
        "agent",
        "/v1/agent/message",
        "POST",
        lastAttempt.payload,
      )) as AgentResult;
      if (token() !== sessionToken)
        throw new Error("Token changed during the request. Send the message again.");
      showResult(result);
      lastAttempt = undefined;
      text("message").value = "";
      status("chat-status", result.status === "failed" ? "Agent run failed." : "");
    });
  });
  element("new-chat").addEventListener("click", () => {
    previousRunId = undefined;
    lastAttempt = undefined;
    messages.replaceChildren();
    status("chat-status", "");
  });

  const now = () => new Date().toISOString();
  const endpoints: Endpoint[] = [];
  const add = (group: string, name: string, target: Target, method: string, path: string, body?: unknown) =>
    endpoints.push({ group, name, target, method, path, body });
  add("Agent", "Health", "agent", "GET", "/health");
  add("Agent", "Send message", "agent", "POST", "/v1/agent/message", {
    requestId: crypto.randomUUID(),
    message: "List my pets",
  });
  add("Agent", "Confirm action", "agent", "POST", "/v1/agent/confirm-action", {
    runId: "RUN_ID",
    confirmed: true,
  });
  add("Agent", "Get run", "agent", "GET", "/v1/agent/runs/RUN_ID");
  add("Agent", "Search matches", "agent", "POST", "/v1/matching/search", { reportId: "REPORT_ID" });
  add("Agent", "Search Bluesky", "agent", "POST", "/v1/ingestion/bluesky/search", {
    city: "Dallas",
    species: "dog",
  });
  add("Agent", "Sync shelters", "agent", "POST", "/v1/ingestion/shelters/sync", {
    latitude: 32.78,
    longitude: -96.8,
  });
  add("Agent", "Search shelter animals", "agent", "POST", "/v1/ingestion/animals/search", {
    latitude: 32.78,
    longitude: -96.8,
    species: "dog",
  });
  add("Agent", "Weather alerts", "agent", "GET", "/v1/weather/alerts?latitude=32.78&longitude=-96.8");
  add("Agent", "Disaster history", "agent", "GET", "/v1/disasters/history?state=TX");
  add("Agent", "List scenarios", "agent", "GET", "/v1/scenarios");
  add("Agent", "Start simulation", "agent", "POST", "/v1/simulations", {
    id: crypto.randomUUID(),
    scenarioId: "tornado",
  });
  add("Agent", "Get simulation", "agent", "GET", "/v1/simulations/SIMULATION_ID");
  add("Agent", "Choose simulation action", "agent", "POST", "/v1/simulations/SIMULATION_ID/choices", {
    choiceId: "shelter",
    revision: 1,
  });
  add("Agent", "Simulation feedback", "agent", "POST", "/v1/simulations/SIMULATION_ID/feedback", {});
  add("Agent", "Sign photo upload", "agent", "POST", "/v1/uploads/sign", {});
  add("Agent", "Get photo URL", "agent", "GET", "/v1/photos/PHOTO_ID/url");
  add("SpacetimeDB", "Create identity", "db", "POST", "/v1/identity");
  add("SpacetimeDB", "Read records", "db", "POST", dbPath("api_read"), ["pets", ""]);
  add(
    "SpacetimeDB",
    "Query a view",
    "db",
    "POST",
    `/v1/database/${encodeURIComponent(database)}/sql`,
    "SELECT * FROM my_pets",
  );
  const reducers: Record<string, object> = {
    register_user: { name: "Test owner", generalLocation: "Dallas" },
    register_pet: { id: crypto.randomUUID(), name: "Max", species: "dog" },
    attach_pet_photo: {
      id: "PHOTO_ID",
      petId: "PET_ID",
      storageKey: "pawsafe/IDENTITY/PHOTO_ID",
      angle: "front",
    },
    create_lost_report: {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      petId: "PET_ID",
      latitude: 32.78,
      longitude: -96.8,
      observedAt: now(),
    },
    create_found_report: {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      species: "dog",
      latitude: 32.78,
      longitude: -96.8,
      observedAt: now(),
      condition: "unknown",
    },
    attach_report_photo: { id: "PHOTO_ID", reportId: "REPORT_ID", storageKey: "pawsafe/IDENTITY/PHOTO_ID" },
    update_report: { reportId: "REPORT_ID", status: "closed" },
    review_match: { matchId: "MATCH_ID", status: "confirmed" },
    mark_notification_read: { id: "NOTIFICATION_ID" },
    register_shelter: { id: crypto.randomUUID(), name: "Test shelter", latitude: 32.78, longitude: -96.8 },
    request_shelter_verification: { shelterId: "SHELTER_ID", evidence: "Review request" },
    set_shelter_verification: { shelterId: "SHELTER_ID", status: "verified" },
    set_shelter_staff: { shelterId: "SHELTER_ID", userId: "USER_ID", role: "staff" },
    update_shelter_capacity: {
      shelterId: "SHELTER_ID",
      totalCapacity: 10,
      currentOccupancy: 5,
      acceptingAnimals: true,
    },
    create_rescue_case: { reportId: "REPORT_ID" },
    assign_rescue_case: { caseId: "CASE_ID", shelterId: "SHELTER_ID" },
    update_case_status: { caseId: "CASE_ID", status: "in_progress" },
    transfer_rescue_case: { caseId: "CASE_ID", shelterId: "SHELTER_ID" },
    resolve_rescue_case: { caseId: "CASE_ID", outcome: "Resolved" },
  };
  const serviceReducers = [
    "grant_service_identity",
    "grant_reviewer_identity",
    "revoke_identity_grant",
    "save_agent_run",
    "record_tool_event",
    "record_simulation_result",
    "set_photo_embedding",
    "complete_matching_job",
    "revoke_external_processing",
    "remove_external_report",
    "inactive_external_listing",
    "upsert_external_report",
    "review_external_photos",
    "propose_match",
    "upsert_directory_shelter",
    "upsert_disaster_alert",
    "create_notification",
  ];
  for (const [name, body] of Object.entries(reducers))
    add("SpacetimeDB reducers", name, "db", "POST", dbPath(name), body);
  for (const name of serviceReducers) add("SpacetimeDB reducers", name, "db", "POST", dbPath(name), {});
  add("Vision", "Health", "vision", "GET", "/health");
  add("Vision", "Embed selected photo", "vision", "POST", "/v1/images/embed", {
    photoId: crypto.randomUUID(),
    imageBase64: "",
  });
  add("Vision", "Compare photos", "vision", "POST", "/v1/images/compare", {
    leftPhotoId: "PHOTO_ID",
    rightPhotoId: "PHOTO_ID",
  });
  add("Vision", "Search pets", "vision", "POST", "/v1/pets/search", {
    candidatePhotoIds: ["PHOTO_ID"],
    topK: 5,
  });
  add("Vision", "Delete embedding", "vision", "DELETE", "/v1/images/PHOTO_ID");
  const endpointPicker = select("endpoint");
  for (const [index, endpoint] of endpoints.entries()) {
    let group = Array.from(endpointPicker.children).find(
      (child) => child.getAttribute("label") === endpoint.group,
    ) as HTMLOptGroupElement | undefined;
    if (!group) {
      group = document.createElement("optgroup");
      group.label = endpoint.group;
      endpointPicker.append(group);
    }
    group.append(new Option(endpoint.name, String(index)));
  }
  function chooseEndpoint() {
    const endpoint = endpoints[Number(endpointPicker.value)];
    select("target").value = endpoint.target;
    select("method").value = endpoint.method;
    input("path").value = endpoint.path;
    text("body").value =
      endpoint.body === undefined
        ? ""
        : typeof endpoint.body === "string"
          ? endpoint.body
          : JSON.stringify(endpoint.body, null, 2);
    element("secret-label").hidden = endpoint.target !== "vision";
  }
  endpointPicker.addEventListener("change", chooseEndpoint);
  select("target").addEventListener("change", () => {
    element("secret-label").hidden = select("target").value !== "vision";
  });
  chooseEndpoint();
  element("api-send").addEventListener("click", () =>
    run("api-send", "api-status", async () => {
      const target = select("target").value as Target;
      const method = select("method").value;
      const path = input("path").value.trim();
      if (!path.startsWith("/") || path.startsWith("//"))
        throw new Error("Use a service-relative path starting with /.");
      let body: unknown;
      if (method === "POST" && text("body").value.trim()) {
        body = path.endsWith("/sql") ? text("body").value : JSON.parse(text("body").value);
        if (target === "db" && /\/call\/(?!api_read(?:\?|$))/.test(path) && !Array.isArray(body))
          body = [JSON.stringify(body)];
        if (
          target === "vision" &&
          path === "/v1/images/embed" &&
          body &&
          typeof body === "object" &&
          !(body as { imageBase64?: string }).imageBase64
        ) {
          const file = input("photo").files?.[0];
          if (!file) throw new Error("Choose a photo in the Photo section.");
          const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Could not read the photo."));
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(file);
          });
          (body as { imageBase64: string }).imageBase64 = encoded;
        }
      }
      const result = await request(target, path, method, body, input("secret").value.trim());
      element("api-result").textContent =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      status("api-status", "Request completed.");
    }),
  );
  void (async () => {
    try {
      const config = (await fetch("/config").then((response) => response.json())) as { database: string };
      database = config.database;
      for (const endpoint of endpoints)
        if (endpoint.target === "db")
          endpoint.path = endpoint.path.replace(
            "/database/pawsafe/",
            `/database/${encodeURIComponent(database)}/`,
          );
      chooseEndpoint();
      const checks = await Promise.allSettled([request("agent", "/health"), request("vision", "/health")]);
      status(
        "service-status",
        `Agent ${checks[0].status === "fulfilled" ? "online" : "offline"} · Vision ${checks[1].status === "fulfilled" ? "online" : "offline"}`,
      );
    } catch {
      status("service-status", "Could not check services.");
    }
  })();
})();
