$("table tr").hide();
$("table tr").each(function(index){
  $(this).delay(index*200).show(50);
});

function scrollToBottom(timedelay=5000) {
        var scrollId;
        var height = 0;
        var minScrollHeight = 100;
        scrollId = setInterval(function () {
            if (height <= document.body.scrollHeight) {
                window.scrollBy(0, minScrollHeight);
            }
            else {
                clearInterval(scrollId);
            }
            height += minScrollHeight;
        }, timedelay);           
    }