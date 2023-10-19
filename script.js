$("table tr").hide();
$("table tr").each(function(index){
	$(this).delay(index*200).show(50);
});