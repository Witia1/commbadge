// Hey there! I know how to install apps. Buttons are dumb now.

define('install',
    ['apps', 'cache', 'capabilities', 'defer', 'jquery', 'l10n', 'log', 'login', 'models', 'notification', 'payments/payments', 'requests', 'tracking', 'urls', 'user', 'views', 'z'],
    function(apps, cache, caps, defer, $, l10n, log, login, models, notification, payments, requests, tracking, urls, user, views, z) {
    'use strict';

    var console = log('install');

    var apps_model = models('app');
    var gettext = l10n.gettext;

    function _handler(func) {
        return function(e) {
            e.preventDefault();
            e.stopPropagation();
            func(apps_model.lookup($(this).closest('[data-slug]').data('slug')));
        };
    }

    var launchHandler = _handler(function(product) {
        z.apps[product.manifest_url].launch();
        tracking.trackEvent(
            'Launch app',
            product.receipt_required ? 'Paid' : 'Free',
            product.slug
        );
    });

    var installHandler = _handler(startInstall);

    function startInstall(product) {
        // TODO: Have the API possibly return this (bug 889501).
        product.receipt_required = (product.premium_type != 'free' &&
                                    product.premium_type != 'free-inapp');

        // If we have a premium app (even if it's '$0.00'), require the user
        // to first log so we can record the purchase and generate a receipt.
        if (product.receipt_required && !user.logged_in()) {
            console.log('Install suspended; user needs to log in');
            return login.login().done(function() {
                startInstall(product);
            }).fail(function(){
                console.log('Install cancelled; login aborted');
                notification.notification({message: gettext('Payment cancelled')});
            });
        }

        console.log('Starting app installation');
        if (product.receipt_required) {
            return purchase(product);
        } else {
            return install(product);
        }
    }

    function purchase(product) {
        z.win.trigger('app_purchase_start', product);
        return defer.when(payments.purchase(product))
                    .done(purchaseSuccess)
                    .fail(purchaseError);
    }

    function purchaseSuccess(product, receipt) {
        console.log('Purchase succeeded, running post-purchase logic');
        if (product.user) {
            product.user.purchased = true;
        } else {
            product.user = {
                purchased: true,
                installed: false
            };
        }

        // Firefox doesn't successfully fetch the manifest unless I do this.
        z.win.trigger('app_purchase_success', [product]);
        setTimeout(function() {
            install(product);
        }, 0);

        // Bust the cache
        cache.bust(urls.api.url('installed'));
        cache.attemptRewrite(function(key) {
            return key === urls.api.params('reviews', {app: product.slug});
        }, function(data) {
            data.user.can_rate = true;
            return data;
        });
        views.reload();
    }

    function purchaseError(product, msg) {
        console.error('Purchase error: ', msg);
        z.win.trigger('app_purchase_error', [product, msg]);
    }

    function install(product, receipt) {
        var data = {};
        var post_data = {
            app: product.id,
            chromeless: caps.chromeless ? 1 : 0
        };

        z.win.trigger('app_install_start', product);

        function do_install() {
            return defer.when(apps.install(product, data))
                        .done(installSuccess)
                        .fail(installError);
        }

        var def = defer.Deferred();
        // NOTE: We don't want to check `payment_required` because
        // even a paid app with a price of '$0.00' should still hit the
        // API endpoint for receipt creation (bug 886568).
        requests.post(urls.api.url('record_' + (product.receipt_required ? 'paid' : 'free')),
                      post_data).done(function(response) {
            if (response.error) {
                $('#pay-error').show().find('div').text(response.error);
                installError(null, product, 'Server returned error: ' + response.error);
                def.reject();
                return;
            }
            if (response.receipt) {
                data.data = {'receipts': [response.receipt]};
            }
            do_install().done(function() {
                def.resolve();
            }).fail(function() {
                def.reject();
            });
        }).fail(function() {
            // Could not record/generate receipt!
            installError(null, product, 'Could not generate receipt');
            def.reject();
        });
        return def;
    }

    function installSuccess(installer, product) {
        console.log('App successfuly installed');
        if (product.user) {
            product.user.installed = true;
        } else {
            product.user = {installed: true};
        }

        z.win.trigger('app_install_success', [installer, product, true]);

        // Bust the cache
        cache.bust(urls.api.url('installed'));
    }

    function installError(installer, product, msg) {
        console.error('Error installing app: ', msg);

        switch (msg) {
            // mozApps error codes, defined in
            // https://developer.mozilla.org/en-US/docs/Apps/Apps_JavaScript_API/Error_object
            case 'MKT_CANCELLED':
            case 'DENIED':
            case 'MANIFEST_URL_ERROR':
            case 'NETWORK_ERROR':
            case 'MANIFEST_PARSE_ERROR':
            case 'INVALID_MANIFEST':
                break;
            // Marketplace specific error codes.
            default:
                // L10n: The app's installation has failed.
                notification.notification({
                    message: gettext('Install failed. Please try again later.')
                });
                break;
        }

        z.win.trigger('app_install_error', [installer, product, msg]);
    }

    z.page.on('click', '.product.launch', launchHandler)
          .on('click', '.button.product:not(.launch):not(.incompatible)', installHandler);

});
