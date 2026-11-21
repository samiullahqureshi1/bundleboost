(function () {
  function formatMoney(cents) {
    var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || undefined;
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: "currency",
        currency: currency,
      }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2);
    }
  }

  function productForm(widget) {
    var section = widget.closest("section, .shopify-section") || document;
    return section.querySelector('form[action*="/cart/add"]') || document.querySelector('form[action*="/cart/add"]');
  }

  function init(widget) {
    if (widget.dataset.bbReady) return;
    widget.dataset.bbReady = "true";

    var prices = {};
    var pricesEl = widget.querySelector("[data-bb-variant-prices]");
    try {
      prices = JSON.parse(pricesEl ? pricesEl.textContent : "{}");
    } catch (e) {
      prices = {};
    }
    var sameCurrency = widget.dataset.sameCurrency === "true";
    var form = productForm(widget);

    function update(variantId) {
      var price = prices[variantId];
      widget.querySelectorAll("[data-bb-offer]").forEach(function (offer) {
        var variants = offer.dataset.variants ? offer.dataset.variants.split(",") : [];
        offer.hidden = variants.length > 0 && variants.indexOf(String(variantId)) === -1;
        if (price === undefined) return;
        offer.querySelectorAll("[data-bb-tier]").forEach(function (tier) {
          var priceEl = tier.querySelector("[data-bb-amount]");
          if (!priceEl) return;
          var value = parseFloat(tier.dataset.value);
          var tierPrice =
            offer.dataset.type === "percentage"
              ? Math.round((price * (100 - value)) / 100)
              : sameCurrency
                ? Math.max(0, price - Math.round(value * 100))
                : null;
          if (tierPrice !== null) priceEl.textContent = formatMoney(tierPrice);
        });
      });
    }

    widget.addEventListener("click", function (event) {
      var tier = event.target.closest("[data-bb-tier]");
      if (!tier) return;
      widget.querySelectorAll("[data-bb-tier]").forEach(function (other) {
        other.setAttribute("aria-pressed", other === tier ? "true" : "false");
      });
      var quantityInput = form && form.querySelector('input[name="quantity"]');
      if (quantityInput) {
        quantityInput.value = tier.dataset.qty;
        quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    if (form) {
      var idInput = form.querySelector('[name="id"]');
      if (idInput) {
        form.addEventListener("change", function () {
          update(idInput.value);
        });
      }
    }

    widget.querySelectorAll("[data-bb-tier]").forEach(function (tier) {
      tier.setAttribute("aria-pressed", "false");
    });
  }

  function initAll() {
    document.querySelectorAll("[data-bb-breaks]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  document.addEventListener("shopify:section:load", initAll);
})();
