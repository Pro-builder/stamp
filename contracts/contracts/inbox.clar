;; inbox.clar
;; Stamp: a paid inbox. Anyone can open an inbox with a price and a reply window.
;; Senders pay the price to send a message, and the STX waits in the contract.
;; If the owner replies in time they earn it. If they decline, or let the window
;; pass, the sender gets it back.

(define-constant ERR_NO_INBOX (err u100))
(define-constant ERR_INBOX_CLOSED (err u101))
(define-constant ERR_SELF_MESSAGE (err u102))
(define-constant ERR_PRICE_CHANGED (err u103))
(define-constant ERR_EMPTY_MESSAGE (err u104))
(define-constant ERR_NO_MESSAGE (err u105))
(define-constant ERR_NOT_RECIPIENT (err u106))
(define-constant ERR_NOT_SENDER (err u107))
(define-constant ERR_NOT_PENDING (err u108))
(define-constant ERR_TOO_LATE (err u109))
(define-constant ERR_TOO_EARLY (err u110))
(define-constant ERR_INVALID_PRICE (err u111))
(define-constant ERR_INVALID_WINDOW (err u112))

(define-constant STATUS_PENDING u0)
(define-constant STATUS_REPLIED u1)
(define-constant STATUS_DECLINED u2)
(define-constant STATUS_RECLAIMED u3)

(define-constant BOX_INBOX u0)
(define-constant BOX_SENT u1)

(define-constant MIN_WINDOW u60)
(define-constant MAX_WINDOW u2592000)

(define-map inboxes
  principal
  {
    price: uint,
    window: uint,
    open: bool,
    received: uint,
    replied: uint,
    earned: uint,
  }
)

(define-map messages
  uint
  {
    from: principal,
    to: principal,
    body: (string-utf8 280),
    paid: uint,
    sent-at: uint,
    deadline: uint,
    status: uint,
    reply: (optional (string-utf8 280)),
  }
)

(define-data-var last-id uint u0)

;; Paged indexes per owner: box u0 is received messages, box u1 is sent ones.
(define-map box-count
  {
    owner: principal,
    box: uint,
  }
  uint
)

(define-map box-index
  {
    owner: principal,
    box: uint,
    index: uint,
  }
  uint
)

(define-private (push-to-box
    (owner principal)
    (box uint)
    (id uint)
  )
  (let ((n (default-to u0 (map-get? box-count {
      owner: owner,
      box: box,
    }))))
    (map-set box-index {
      owner: owner,
      box: box,
      index: n,
    }
      id
    )
    (map-set box-count {
      owner: owner,
      box: box,
    }
      (+ n u1)
    )
  )
)

(define-private (pending-message (id uint))
  (let ((msg (unwrap! (map-get? messages id) ERR_NO_MESSAGE)))
    (asserts! (is-eq (get status msg) STATUS_PENDING) ERR_NOT_PENDING)
    (ok msg)
  )
)

(define-private (refund-sender
    (id uint)
    (status uint)
  )
  (let (
      (msg (try! (pending-message id)))
      (sender (get from msg))
      (amount (get paid msg))
    )
    (try! (as-contract? ((with-stx amount))
      (try! (stx-transfer? amount tx-sender sender))
    ))
    (map-set messages id (merge msg { status: status }))
    (ok msg)
  )
)

(define-public (open-inbox
    (price uint)
    (window uint)
  )
  (let ((current (map-get? inboxes contract-caller)))
    (asserts! (> price u0) ERR_INVALID_PRICE)
    (asserts! (and (>= window MIN_WINDOW) (<= window MAX_WINDOW))
      ERR_INVALID_WINDOW
    )
    (map-set inboxes contract-caller {
      price: price,
      window: window,
      open: true,
      received: (default-to u0 (get received current)),
      replied: (default-to u0 (get replied current)),
      earned: (default-to u0 (get earned current)),
    })
    (print {
      event: "inbox-opened",
      owner: contract-caller,
      price: price,
      window: window,
    })
    (ok true)
  )
)

(define-public (close-inbox)
  (let ((inbox (unwrap! (map-get? inboxes contract-caller) ERR_NO_INBOX)))
    (map-set inboxes contract-caller (merge inbox { open: false }))
    (print {
      event: "inbox-closed",
      owner: contract-caller,
    })
    (ok true)
  )
)

;; expected-price stops the owner from raising the price between the sender
;; opening the form and the transaction confirming.
(define-public (send-message
    (to principal)
    (body (string-utf8 280))
    (expected-price uint)
  )
  (let (
      (sender tx-sender)
      (inbox (unwrap! (map-get? inboxes to) ERR_NO_INBOX))
      (price (get price inbox))
      (id (+ (var-get last-id) u1))
    )
    (asserts! (get open inbox) ERR_INBOX_CLOSED)
    (asserts! (not (is-eq sender to)) ERR_SELF_MESSAGE)
    (asserts! (> (len body) u0) ERR_EMPTY_MESSAGE)
    (asserts! (is-eq expected-price price) ERR_PRICE_CHANGED)
    (try! (stx-transfer? price sender current-contract))
    (map-set messages id {
      from: sender,
      to: to,
      body: body,
      paid: price,
      sent-at: stacks-block-time,
      deadline: (+ stacks-block-time (get window inbox)),
      status: STATUS_PENDING,
      reply: none,
    })
    (map-set inboxes to (merge inbox { received: (+ (get received inbox) u1) }))
    (push-to-box to BOX_INBOX id)
    (push-to-box sender BOX_SENT id)
    (var-set last-id id)
    (print {
      event: "message-sent",
      id: id,
      from: sender,
      to: to,
      paid: price,
    })
    (ok id)
  )
)

(define-public (reply
    (id uint)
    (body (string-utf8 280))
  )
  (let (
      (msg (try! (pending-message id)))
      (owner (get to msg))
      (amount (get paid msg))
      (inbox (unwrap! (map-get? inboxes owner) ERR_NO_INBOX))
    )
    (asserts! (is-eq contract-caller owner) ERR_NOT_RECIPIENT)
    (asserts! (< stacks-block-time (get deadline msg)) ERR_TOO_LATE)
    (asserts! (> (len body) u0) ERR_EMPTY_MESSAGE)
    (try! (as-contract? ((with-stx amount))
      (try! (stx-transfer? amount tx-sender owner))
    ))
    (map-set messages id
      (merge msg {
        status: STATUS_REPLIED,
        reply: (some body),
      })
    )
    (map-set inboxes owner
      (merge inbox {
        replied: (+ (get replied inbox) u1),
        earned: (+ (get earned inbox) amount),
      })
    )
    (print {
      event: "replied",
      id: id,
      to: owner,
      amount: amount,
    })
    (ok true)
  )
)

(define-public (decline (id uint))
  (let ((msg (try! (pending-message id))))
    (asserts! (is-eq contract-caller (get to msg)) ERR_NOT_RECIPIENT)
    (try! (refund-sender id STATUS_DECLINED))
    (print {
      event: "declined",
      id: id,
      from: (get from msg),
      amount: (get paid msg),
    })
    (ok true)
  )
)

(define-public (reclaim (id uint))
  (let ((msg (try! (pending-message id))))
    (asserts! (is-eq contract-caller (get from msg)) ERR_NOT_SENDER)
    (asserts! (>= stacks-block-time (get deadline msg)) ERR_TOO_EARLY)
    (try! (refund-sender id STATUS_RECLAIMED))
    (print {
      event: "reclaimed",
      id: id,
      from: (get from msg),
      amount: (get paid msg),
    })
    (ok true)
  )
)

(define-read-only (get-inbox (owner principal))
  (map-get? inboxes owner)
)

(define-read-only (get-message (id uint))
  (map-get? messages id)
)

(define-read-only (get-last-id)
  (var-get last-id)
)

(define-read-only (get-box-count
    (owner principal)
    (box uint)
  )
  (default-to u0 (map-get? box-count {
    owner: owner,
    box: box,
  }))
)

(define-private (collect-message
    (step uint)
    (acc {
      owner: principal,
      box: uint,
      start: uint,
      found: (list 10 {
        id: uint,
        from: principal,
        to: principal,
        body: (string-utf8 280),
        paid: uint,
        sent-at: uint,
        deadline: uint,
        status: uint,
        reply: (optional (string-utf8 280)),
      }),
    })
  )
  (match (map-get? box-index {
    owner: (get owner acc),
    box: (get box acc),
    index: (+ (get start acc) step),
  })
    id (match (map-get? messages id)
      msg (merge acc { found: (default-to (get found acc)
        (as-max-len? (append (get found acc) (merge msg { id: id })) u10)
      ) })
      acc
    )
    acc
  )
)

;; Up to 10 messages from one box, oldest first, starting at offset.
(define-read-only (get-page
    (owner principal)
    (box uint)
    (offset uint)
  )
  {
    total: (get-box-count owner box),
    messages: (get found
      (fold collect-message (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9) {
        owner: owner,
        box: box,
        start: offset,
        found: (list),
      })
    ),
  }
)
